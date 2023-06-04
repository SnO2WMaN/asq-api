import { z } from "https://deno.land/x/zod@v3.16.1/mod.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Hono } from "https://deno.land/x/hono@v3.2.4/mod.ts";

const UQUERY = `
  query ($username: String!){
    User(name: $username) {
      id
      name
      avatar {
        large
      }
    }
    completed: MediaListCollection(
      userName: $username
      type: ANIME,
      status: COMPLETED
    ) {
      lists {
        entries {
          score
          media {
            id
          }
        }
      }
    }
    etc: MediaListCollection(
      userName: $username
      type: ANIME,
      status_in: [CURRENT,PAUSED,PLANNING,DROPPED]
    ) {
      lists {
        entries {
          status
          media {
            id
          }
        }
      }
    }
  }`;
const USCHEMA = z.object({
  User: z.object({
    id: z.number(),
    name: z.string(),
    avatar: z.object({ large: z.string().url() }),
  }),
  completed: z.object({
    lists: z.array(
      z.object({
        entries: z.array(
          z.object({
            score: z.number(),
            media: z.object({ id: z.number() }),
          })
        ),
      })
    ),
  }),
  etc: z.object({
    lists: z.array(
      z.object({
        entries: z.array(
          z.object({
            status: z.union([
              z.literal("CURRENT"),
              z.literal("PAUSED"),
              z.literal("PLANNING"),
              z.literal("DROPPED"),
            ]),
            media: z.object({ id: z.number() }),
          })
        ),
      })
    ),
  }),
});
const fetchUser = async (username: string) => {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    body: JSON.stringify({ query: UQUERY, variables: { username: username } }),
    headers: { "Content-Type": "application/json" },
  });
  const data: {
    MediaListCollection: {
      user: { name: string; avatar: { large: string } };
      lists: [{ entries: { score: number; media: { id: number } }[] }];
    };
  } = (await response.json()).data;

  const psed = USCHEMA.parse(data);

  return {
    username: psed.User.name,
    avatar: psed.User.avatar.large,
    completed: psed.completed.lists
      .map(({ entries }) => entries)[0]
      .map(({ score, media: { id } }) => ({ score, id })),
    etc: psed.etc.lists
      .map(({ entries }) => entries)
      .flat()
      .map(({ status, media: { id } }) => ({ status, id })),
  };
};

const AQUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      idMal
      title {
        english
        native
      }
      coverImage {
        large
      }
    }
  }
`;
const ASCHEMA = z.object({
  Media: z.object({
    id: z.number(),
    title: z.object({ native: z.string() }),
    coverImage: z.object({ large: z.string().url() }),
  }),
});
const fetchAnime = async (id: number) => {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    body: JSON.stringify({ query: AQUERY, variables: { id: id } }),
    headers: { "Content-Type": "application/json" },
  });
  const data: {
    MediaListCollection: {
      user: { name: string; avatar: { large: string } };
      lists: [{ entries: { score: number; media: { id: number } }[] }];
    };
  } = (await response.json()).data;

  const psed = ASCHEMA.parse(data);

  return {
    id: psed.Media.id,
    titleNative: psed.Media.title.native,
    coverImage: psed.Media.coverImage.large,
  };
};

const fetchFromAnilist = async (usernames: string[], dup: number) => {
  const ahyear = await Promise.all(
    usernames.map((username) => fetchUser(username))
  );
  const whole = [
    ...new Set(
      ahyear
        .map(({ completed }) => completed.map(({ id }) => id))
        .flat()
        .filter((v, _, arr) => dup <= arr.filter((v2) => v === v2).length)
    ),
  ];

  if (whole.length === 0) {
    console.log("No dup");
    return;
  }

  const pick = whole[Math.floor(Math.random() * whole.length)];
  const anime = await fetchAnime(pick);

  return {
    anime,
    users: ahyear
      .filter(
        ({ completed, etc }) =>
          completed.findIndex(({ id }) => id === pick) !== -1 ||
          etc.findIndex(({ id }) => id === pick) !== -1
      )
      .map(({ completed, etc, ...rest }) => ({
        score: completed.find(({ id }) => id === pick)?.score,
        status: etc.find(({ id }) => id === pick)?.status,
        ...rest,
      })),
  };
};

const app = new Hono();
app.get("/", async (c) => {
  const usernames = c.req.query("anilist")?.split(",");
  if (!usernames || usernames.length === 0) {
    return c.text("No usernames");
  }

  const dup = Number(c.req.query("dup"));
  const json = await fetchFromAnilist(
    usernames,
    !Number.isNaN(dup) && dup <= usernames.length ? dup : usernames.length - 1
  );
  return c.json(json);
});
serve(app.fetch);
