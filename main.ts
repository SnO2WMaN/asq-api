import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Hono } from "https://deno.land/x/hono@v3.2.4/mod.ts";
import { z } from "https://deno.land/x/zod@v3.16.1/mod.ts";
import { Result, convert, err, isErr, ok } from "./results.ts";

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
const fetchUser = async (
  username: string
): Promise<
  Result<
    | { type: "NOT_FOUND"; username: string }
    | { type: "PARSE_FAILED"; username: string },
    {
      username: string;
      avatar: string;
      completed: { score: number; id: number }[];
      etc: {
        status: "CURRENT" | "PAUSED" | "PLANNING" | "DROPPED";
        id: number;
      }[];
    }
  >
> => {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    body: JSON.stringify({ query: UQUERY, variables: { username: username } }),
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()).data;

  if (!data) return err({ type: "NOT_FOUND", username });

  const psed = z
    .object({
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
    })
    .safeParse(data);

  if (!psed.success) return err({ type: "PARSE_FAILED", username });

  return ok({
    username: psed.data.User.name,
    avatar: psed.data.User.avatar.large,
    completed: psed.data.completed.lists
      .map(({ entries }) => entries)[0]
      .map(({ score, media: { id } }) => ({ score, id })),
    etc: psed.data.etc.lists
      .map(({ entries }) => entries)
      .flat()
      .map(({ status, media: { id } }) => ({ status, id })),
  });
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
const fetchAnime = async (
  id: number
): Promise<
  Result<
    { type: "NOT_FOUND"; id: number } | { type: "PARSE_FAILED"; id: number },
    {
      id: number;
      titleNative: string;
      coverImage: string;
    }
  >
> => {
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

  if (!data) return err({ type: "NOT_FOUND", id });

  const psed = z
    .object({
      Media: z.object({
        id: z.number(),
        title: z.object({ native: z.string() }),
        coverImage: z.object({ large: z.string().url() }),
      }),
    })
    .safeParse(data);
  if (!psed.success) return err({ type: "PARSE_FAILED", id });

  return ok({
    id: psed.data.Media.id,
    titleNative: psed.data.Media.title.native,
    coverImage: psed.data.Media.coverImage.large,
  });
};

const pickRandom = async (
  usernames: string[],
  dup: number
): Promise<
  Result<
    | {
        type: "FAILED_FETCH_USERS";
        errors: { type: "NOT_FOUND" | "PARSE_FAILED"; username: string }[];
      }
    | { type: "FAILED_FETCH_ANIME"; anilistId: number }
    | { type: "NO_DUPLICATE" },
    {
      anime: {
        id: number;
        titleNative: string;
        coverImage: string;
      };
      users: (
        | { username: string; avatar: string } & (
            | { score: number }
            | { status: "CURRENT" | "PAUSED" | "PLANNING" | "DROPPED" }
          )
      )[];
    }
  >
> => {
  const fetchedUsers = convert(
    await Promise.all(usernames.map((username) => fetchUser(username)))
  );
  if (isErr(fetchedUsers)) {
    return err({
      type: "FAILED_FETCH_USERS",
      errors: fetchedUsers.error.map(({ type, username }) => ({
        type,
        username,
      })),
    });
  }

  const whole = [
    ...new Set(
      fetchedUsers.data
        .map(({ completed }) => completed.map(({ id }) => id))
        .flat()
        .filter((v, _, arr) => dup <= arr.filter((v2) => v === v2).length)
    ),
  ];

  if (whole.length === 0) return err({ type: "NO_DUPLICATE" });

  const pick = whole[Math.floor(Math.random() * whole.length)];
  const anime = await fetchAnime(pick);

  if (isErr(anime)) {
    return err({ type: "FAILED_FETCH_ANIME", anilistId: pick });
  }

  return ok({
    anime: anime.data,
    users: [
      ...fetchedUsers.data
        .filter(({ completed }) => completed.find(({ id }) => id === pick))
        .map(({ completed, username, avatar }) => ({
          username,
          avatar,
          score: completed.find(({ id }) => id === pick)!.score,
        })),
      ...fetchedUsers.data
        .filter(({ etc }) => etc.find(({ id }) => id === pick))
        .map(({ etc, username, avatar }) => ({
          username,
          avatar,
          status: etc.find(({ id }) => id === pick)!.status,
        })),
    ],
  });
};

const app = new Hono();
app.get("/", async (c) => {
  const usernames = c.req.query("anilist")?.split(",");
  if (!usernames || usernames.length === 0)
    return c.json({ message: "NO_USERNAMES" }, 400);

  const qdup = Number(c.req.query("dup"));
  const dup =
    !Number.isNaN(qdup) && qdup <= usernames.length
      ? qdup
      : usernames.length - 1;

  const res = await pickRandom(usernames, dup);
  if (isErr(res)) {
    switch (res.error.type) {
      case "FAILED_FETCH_USERS":
        return c.json(
          { message: "FAILED_FETCH_USERS", payload: res.error },
          400
        );
      case "NO_DUPLICATE":
        return c.json({ message: "NO_DUPLICATE" }, 404);
      case "FAILED_FETCH_ANIME":
        return c.json({ message: "FAILED_FETCH_ANIME" }, 500);
      default:
        return c.json({ message: "UNKNOWN_ERROR" }, 500);
    }
  }

  return c.json(res.data);
});
serve(app.fetch);
