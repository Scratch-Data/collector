/* eslint-disable no-restricted-syntax */
const HTMLParser = require("node-html-parser");
const fetch = require("node-fetch");
const fs = require("fs");
const shn = require("short-numbers");
const { render: m } = require("mustache");
const { decodeHTML } = require("entities");
const { fastify } = require("fastify");
// const db = require("level")("comments");
const pThrottle = require("p-throttle");
const users = require("./users.json").slice(0, 100);

const throttle = pThrottle({
  limit: 15,
  interval: 1000,
});

const concurrentFetch = throttle((...args) => fetch(...args));

const template = fs.readFileSync("web.mustache").toString();

/**
 *
 * @param {string} html HTML to get comments from
 * @returns {{
 *   user: string,
 *   content: string,
 *   time: string,
 *   id: string,
 *   link: string,
 *   profile: string
 * }[]} Comments
 */

function parseCommentsFromHTML(html) {
  const root = HTMLParser.parse(html);
  const commentElements = root.querySelectorAll("div.comment");
  return commentElements.map((commentElement) => {
    const user = commentElement
      .querySelector("#comment-user[data-comment-user]")
      .getAttribute("data-comment-user");
    const content = decodeHTML(
      commentElement.querySelector(".info > .content").innerText
    ).trimStart();
    const time = commentElement
      .querySelector(".info .time")
      .getAttribute("title");
    const { id } = commentElement;
    const link = `https://scratch.mit.edu/users/${user}#${id}`;
    const profile = process.argv[2];
    return { user, content, time, id, link, profile };
  });
}

let collected = [];

/**
 *
 * @param user {string}
 */

async function processUser(user) {
  let page = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const res = await concurrentFetch(
      `https://scratch.mit.edu/site-api/comments/user/${user}?page=${page}`
    );
    if ([404, 429, 503].includes(res.status)) {
      break;
    }
    if (!res.ok) {
      throw new Error(`Expected 404 or 2XX, got ${res.status}.`);
    }
    // eslint-disable-next-line no-await-in-loop
    let html = await res.text();
    let comments = parseCommentsFromHTML(html);
    html = null;
    collected = collected.concat(comments);
    // let ops = comments.map((comment) => ({
    //   type: "put",
    //   key: comment.id,
    //   value: JSON.stringify(comment),
    // }));
    // eslint-disable-next-line no-await-in-loop
    // await db.batch(ops);
    comments = null;
    // ops = null;
    page += 1;
  }
}

function main() {
  return Promise.all(users.map((user) => processUser(user)));
}

const server = fastify();

server.get("/", (_req, res) => {
  res.type("text/html");
  res.send(m(template, { count: shn(collected.length) }));
});

server.get("/data", (_req, res) => {
  res.type("application/json");
  res.send(JSON.stringify(collected));
});

server.listen(3000, "0.0.0.0").then((address) => {
  console.log(`Server is listening on ${address}!`);
});

main().then(() => console.log(collected));
