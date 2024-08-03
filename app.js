const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
let db;

const initDBServer = async () => {
  try {
    db = await open({
      filename: path.join(__dirname, "twitterClone.db"),
      driver: sqlite3.Database,
    });
    app.listen(3001);
  } catch (e) {
    console.log(e);
  }
};

initDBServer();
app.use(express.json());

app.post("/register/", async (req, res) => {
  const { username, password, name, gender } = req.body;
  const dbQuery = `
        SELECT
          *
        FROM 
          user
        WHERE
          username = "${username}";
    `;
  const result = await db.get(dbQuery);
  if (result !== undefined) {
    res.status(400);
    res.send("User already exists");
  } else {
    if (password.length < 6) {
      res.status(400);
      res.send("Password is too short");
    } else {
      const hashedPwd = await bcrypt.hash(password, 7);
      const registerQuery = `
            INSERT INTO user(username, password, name, gender) VALUES ("${username}", "${hashedPwd}", "${name}", "${gender}");
        `;
      await db.run(registerQuery);
      res.status(200);
      res.send("User created successfully");
    }
  }
});

app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const dbQuery = `
        SELECT
          *
        FROM 
          user
        WHERE
          username = "${username}";
    `;
  const result = await db.get(dbQuery);
  if (result === undefined) {
    res.status(400);
    res.send("Invalid user");
  } else {
    const isValidPwd = await bcrypt.compare(password, result.password);
    if (!isValidPwd) {
      res.status(400);
      res.send("Invalid password");
    } else {
      const token = jwt.sign(result, "KKR_TOKEN");
      res.send({ jwtToken: token });
    }
  }
});

const verifyUser = (req, res, next) => {
  const header = req.headers["authorization"];
  if (header === undefined) {
    res.status(401);
    res.send("Invalid JWT Token");
  } else {
    const token = header.split(" ")[1];
    if (token === undefined) {
      res.status(401);
      res.send("Invalid JWT Token");
    } else {
      jwt.verify(token, "KKR_TOKEN", (error, payload) => {
        if (error) {
          res.status(401);
          res.send("Invalid JWT Token");
        } else {
          req.userDetails = payload;
          next();
        }
      });
    }
  }
};

const isUserFollowing = async (req, res, next) => {
  const { user_id } = req.userDetails;
  const { tweetId } = req.params;
  const userIdTweetedQuery = `
    SELECT
      user_id
    FROM
      tweet
    WHERE
      tweet_id = ${tweetId};
    `;
  const userTweeted = await db.get(userIdTweetedQuery);
  const userIdTweeted = userTweeted.user_id;

  const followingQuery = `
    SELECT
      user.user_id
    FROM
      user INNER JOIN follower ON follower.following_user_id = user.user_id
    WHERE
      follower.follower_user_id = ${user_id};
    `;
  const followingUserIds = await db.all(followingQuery);
  let flag = 0;
  for (let i = 0; i < followingUserIds.length; i++) {
    if (followingUserIds[i].user_id === userIdTweeted) {
      flag++;
      break;
    }
  }
  if (flag === 0) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    next();
  }
};

app.get("/user/tweets/feed/", verifyUser, async (req, res) => {
  const { username } = req.userDetails;
  const getIdQuery = `
    SELECT
      user_id
    FROM
      user
    WHERE
      username = "${username}";
  `;
  const { user_id } = await db.get(getIdQuery);

  const tweetsQuery = `
    SELECT
      user.username,
      tweet.tweet,
      tweet.date_time AS dateTime
    FROM
      user INNER JOIN tweet ON user.user_id = tweet.user_id
      INNER JOIN follower ON follower.following_user_id = user.user_id
    WHERE
      follower.follower_user_id = ${user_id}
    ORDER BY tweet.date_time DESC
    LIMIT 4;    
  `;

  const result = await db.all(tweetsQuery);
  res.send(result);
});

app.get("/user/following/", verifyUser, async (req, res) => {
  const { user_id } = req.userDetails;
  const followingQuery = `
    SELECT
      user.name
    FROM
      user INNER JOIN follower ON follower.following_user_id = user.user_id
    WHERE
      follower.follower_user_id = ${user_id};
    `;
  const result = await db.all(followingQuery);
  res.send(result);
});

app.get("/user/followers/", verifyUser, async (req, res) => {
  const { user_id } = req.userDetails;
  const followingQuery = `
    SELECT
      user.name
    FROM
      user INNER JOIN follower ON follower.follower_user_id = user.user_id
    WHERE
      follower.following_user_id = ${user_id};
    `;
  const result = await db.all(followingQuery);
  res.send(result);
});

app.get("/tweets/:tweetId/", verifyUser, isUserFollowing, async (req, res) => {
  const { tweetId } = req.params;
  const tweetDbQuery = `
        SELECT
          tweet.tweet as tweet,
          COUNT(DISTINCT like.like_id) AS likes,
          COUNT(DISTINCT reply.reply_id) AS replies,
          tweet.date_time AS dateTime
        FROM
          tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
          INNER JOIN like ON tweet.tweet_id = like.tweet_id
        WHERE
          tweet.tweet_id = ${tweetId}
        GROUP BY 
          tweet.tweet_id;        
      `;

  const result = await db.get(tweetDbQuery);
  res.send(result);
});

app.get(
  "/tweets/:tweetId/likes/",
  verifyUser,
  isUserFollowing,
  async (req, res) => {
    const { tweetId } = req.params;
    const likeDbQuery = `
        SELECT
          user.username AS username
        FROM
          like INNER JOIN user ON like.user_id = user.user_id
        WHERE
          like.tweet_id = ${tweetId};
      `;

    const result = await db.all(likeDbQuery);
    let likes = [];
    for (let i = 0; i < result.length; i++) {
      likes.push(result[i].username);
    }
    res.send({ likes: likes });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  verifyUser,
  isUserFollowing,
  async (req, res) => {
    const { tweetId } = req.params;
    const replQuery = `
        SELECT
          user.name AS name,
          reply.reply AS reply
        FROM
          user INNER JOIN reply ON user.user_id = reply.user_id
        WHERE
          reply.tweet_id = ${tweetId};
      `;
    const result = await db.all(replQuery);
    res.send({ replies: result });
  }
);

app.get("/user/tweets/", verifyUser, async (req, res) => {
  const { user_id } = req.userDetails;
  const tweetDbQuery = `
        SELECT
          tweet.tweet as tweet,
          COUNT(DISTINCT like.like_id) AS likes,
          COUNT(DISTINCT reply.reply_id) AS replies,
          tweet.date_time AS dateTime
        FROM
          tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
          INNER JOIN like ON tweet.tweet_id = like.tweet_id
        WHERE
          tweet.user_id = ${user_id}
        GROUP BY 
          tweet.tweet_id;        
      `;

  const result = await db.all(tweetDbQuery);
  res.send(result);
});

app.post("/user/tweets/", verifyUser, async (req, res) => {
  const { user_id } = req.userDetails;
  const { tweet } = req.body;
  const postTwtQuery = `
      INSERT INTO tweet(tweet, user_id) VALUES ('${tweet}', ${user_id});
    `;
  await db.run(postTwtQuery);
  res.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", verifyUser, async (req, res) => {
  const { user_id } = req.userDetails;
  const { tweetId } = req.params;
  const getUserIdQuery = `
      SELECT user_id
      FROM tweet
      WHERE tweet.tweet_id = ${tweetId};
    `;
  const tweetUserId = await db.get(getUserIdQuery);
  if (tweetUserId.user_id !== user_id) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    const delQuery = `
      DELETE FROM tweet WHERE tweet_id = ${tweetId};
      `;
    await db.run(delQuery);
    res.send("Tweet Removed");
  }
});

module.exports = app;
