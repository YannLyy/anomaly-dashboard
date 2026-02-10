// src/web/server.js
import "dotenv/config";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "discord.js";

import {
  getAuthUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  fetchDiscordGuilds,
  avatarUrl,
  bannerUrl,
  guildIconUrl
} from "./auth.js";

import { requireAuth, injectUser } from "./middleware.js";
import { GuildStore } from "../bot/storage/guildStore.js";
import { CATEGORIES } from "../shared/manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------------- BOT CLIENT (pour savoir où il est présent) ---------------- */
const botClient = new Client({ intents: [] });
await botClient.login(process.env.DISCORD_BOT_TOKEN);

/* ---------------- HELPERS ---------------- */
function canInviteBot(guild) {
  const perms = BigInt(guild.permissions);
  const ADMIN = 0x8n;
  const MANAGE_GUILD = 0x20n;
  return (perms & ADMIN) === ADMIN || (perms & MANAGE_GUILD) === MANAGE_GUILD;
}

function botIsInGuild(guildId) {
  return botClient.guilds.cache.has(guildId);
}

/* ---------------- EXPRESS ---------------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false
  })
);

app.use(injectUser);

/* ---------------- ROUTES ---------------- */
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return res.redirect("/guilds");
});

app.get("/login", (req, res) => {
  res.render("login", { botName: "Anomaly", authUrl: getAuthUrl() });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/auth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect("/login");

    const token = await exchangeCodeForToken(code);
    const user = await fetchDiscordUser(token.access_token);
    const guilds = await fetchDiscordGuilds(token.access_token);

    req.session.user = {
      id: user.id,
      username: user.username,
      global_name: user.global_name || null,
      avatar: avatarUrl(user),
      banner: bannerUrl(user)
    };

    req.session.guilds = (guilds || []).map(g => {
      const canInvite = canInviteBot(g);
      const botPresent = botIsInGuild(g.id);

      return {
        id: g.id,
        name: g.name,
        icon: guildIconUrl(g),
        canInvite,
        botPresent
      };
    });

    res.redirect("/guilds");
  } catch (e) {
    console.error(e);
    res.status(500).send("Erreur auth Discord.");
  }
});

/* ---------------- GUILDS ---------------- */
app.get("/guilds", requireAuth, (req, res) => {
  res.render("guilds", {
    botName: "Anomaly",
    me: req.session.user,
    guilds: req.session.guilds || []
  });
});

/* ---------------- GUILD CONFIG ---------------- */
app.get("/guild/:id", requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const guild = (req.session.guilds || []).find(g => g.id === guildId);

  if (!guild || !guild.botPresent) {
    return res.status(403).send("Bot non présent sur ce serveur.");
  }

  const cfg = await GuildStore.get(guildId);
  cfg.commands ||= {};
  cfg.modules ||= {};

  res.render("guild", {
    botName: "Anomaly",
    me: req.session.user,
    guild,
    guildId,
    cfg,
    categories: CATEGORIES
  });
});

/* ---------------- API ---------------- */
app.post("/api/guild/:id/prefix", requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const prefix = String(req.body.prefix || "+").slice(0, 5);
  const cfg = await GuildStore.patch(guildId, { prefix });
  res.json({ ok: true, prefix: cfg.prefix });
});

app.post("/api/guild/:id/command", requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { fullName, enabled } = req.body;

  const cfg = await GuildStore.get(guildId);
  cfg.commands ||= {};
  cfg.commands[fullName] = { enabled };
  await GuildStore.set(guildId, cfg);

  res.json({ ok: true });
});

app.post("/api/guild/:id/module", requireAuth, async (req, res) => {
  const guildId = req.params.id;
  const { module, enabled } = req.body;

  const cfg = await GuildStore.get(guildId);
  cfg.modules ||= {};
  cfg.modules[module] = { enabled };
  await GuildStore.set(guildId, cfg);

  res.json({ ok: true });
});

/* ---------------- START ---------------- */
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Dashboard Anomaly: http://localhost:${port}`);
});
