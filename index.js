const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { google } = require("googleapis");
const { response } = require("express");
const request = require("request");
const urlParse = require("url-parse");
const queryParse = require("query-string");
const axios = require("axios");

require("dotenv").config();
const port = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/**
 *
 * Useful reference: https://developers.google.com/identity/protocols/oauth2/web-server#offline
 *
 * sign up Logic:
 * 1. user goto /starter by url provided by clinicians
 * 2. user request: check user id and record of [access_token, refresh_token, expiry]
 *  - if not exist:
 *      - log him in and store tokens
 *
 * cron job logic:
 * 1. loop through db
 * 2. send user data request to fit API [DONE]
 * 3. store returned data to db
 */

app.get("/", (req, res) => {
  const health = app ? true : false;
  const upTime = process.uptime();
  const cpuUsage = process.cpuUsage();

  const response_html = `<html>
    <p>Server Healthy: ${health}</p>
    <p>Up Time: ${upTime}s</p>
    <p>Cpu Usage: ${cpuUsage.system}</p>
    <p>Visit <a href="">http://localhost:5000/starter?id={validpatientid}</a> for automated health data collection</p>
  </html>`;
  return res.send(response_html);
});

app.get("/starter", (req, res) => {
  const patientID = req.query.id;
  res.cookie("id", patientID).redirect("http://localhost:5000/getURLTing");
});

app.get("/getURLTing", (req, res) => {
  const cookie = cookieParser(req.headers.cookie).id;

  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "http://localhost:5000/steps"
  );

  const scopes = [
    "https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.sleep.read  profile email openid",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state: JSON.stringify({
      callbackUrl: req.body.callbackUrl,
      userID: req.body.userid,
    }),
  });

  request(url, (err, response, body) => {
    err && console.log("error :>> ", err);
    // console.log('statusCode :>> ', response &  response.statusCode);
    // res.send({url})
    res.cookie("id", cookie).redirect(url);
  });
});

app.get("/steps", async (req, res) => {
  const cookie = cookieParser(req.headers.cookie).id;
  const queryURL = new urlParse(req.url);
  const code = queryParse.parse(queryURL.query).code;

  // console.log('code :>> ', code);

  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "http://localhost:5000/steps"
  );

  const tokens = await oauth2Client.getToken(code);
  // console.log('tokens :>> ', tokens);

  let healthDataArray = [];

  try {
    const result = await axios({
      method: "POST",
      headers: {
        authorization: "Bearer " + tokens.tokens.access_token,
      },
      "Content-Type": "application/json",
      url: `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate`,
      data: {
        aggregateBy: [
          {
            dataTypeName: "com.google.step_count.delta",
            dataSourceId:
              "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps",
          },
          {
            dataTypeName: "com.google.calories.expended",
            dataSourceId:
              "derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended",
          },
          {
            dataTypeName: "com.google.sleep.segment",
            dataSourceId:
              "derived:com.google.sleep.segment:com.google.android.gms:merged",
          },
          {
            dataTypeName: "com.google.heart_minutes",
            dataSourceId:
              "derived:com.google.heart_minutes:com.google.android.gms:from_steps<-estimated_steps",
          },
        ],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: Date.now() - 7 * 86400000,
        endTimeMillis: Date.now(),
      },
    });

    // const sources = await axios({
    //   method: "GET",
    //   headers: {
    //     authorization: "Bearer " + tokens.tokens.access_token,
    //   },
    //   "Content-Type": "application/json",
    //   url: `https://fitness.googleapis.com/fitness/v1/users/me/dataSources`,
    // });

    // console.log("sources :>> ", JSON.stringify(sources.data));

    healthDataArray = result.data.bucket;
  } catch (error) {
    console.log("error :>> ", error);
  }

  try {
    // console.log("healthDataArray :>> ", healthDataArray);
    for (const dataset of healthDataArray) {
      // console.log('dataset :>> ', dataset);
      for (const point of dataset.dataset) {
        // console.log('point :>> ', point);
        for (const value of point.point) {
          console.log("useId :>> ", cookie);
          console.log(
            "date :>> ",
            new Date(value.endTimeNanos / 1000000).toUTCString()
          );
          console.log("value :>> ", value.value);
        }
      }
    }
  } catch (error) {
    console.log("error :>> ", error);
  }

  return res.send(
    `Successfully Logged In, your current data is ${JSON.stringify(
      healthDataArray
    )}`
  );
});

app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);

/**
 * Function to turn cookie extracted from request header into usable object
 * @example cookieParser(req.headers.cookie)
 * @param {String} cookie
 */
const cookieParser = (cookie) => {
  let parsedCookie = {};
  const pairs = cookie.split(";");
  pairs.forEach((cookie_pair) => {
    const key_val = cookie_pair.split("=");
    parsedCookie[key_val[0]] = key_val[1];
  });

  return parsedCookie;
};
