# wow-discord-bot

Button-based role picker for the Exodus Discord. Members press a button under a message in
`#auto-roles` and the bot assigns the matching role. Everything is driven by `config.json`.

## Running on the server

```sh
cp .env.example .env      # then paste the bot token into .env
docker compose up -d --build
docker compose logs -f
```

Locally with Podman the same file works: `podman compose up -d --build`.

## First start

Each picker in `config.json` has a `messageId`. Leave it empty the first time. On startup the bot
posts the picker message in the configured channel and logs a line like:

```
Picker "class": posted new message 1234567890 in #auto-roles. Set "messageId": "1234567890" in config.json ...
```

Paste that id into `config.json` and restart. From then on every restart edits that message in place,
so changing the text or buttons is just: edit `config.json`, `docker compose restart`.

`config.json` is mounted into the container, so config changes never need a rebuild. Code changes do
(`docker compose up -d --build`).

## Config reference

```json
{
  "pickers": [
    {
      "id": "class",                // used inside button ids; letters, digits, - and _
      "label": "class",             // used in replies: "Your class is now Mage"
      "channelId": "…",
      "messageId": "",              // empty on first run, then the id the bot logged
      "content": "Message text",
      "mode": "single",             // "single": one role at a time. "multi": buttons toggle
      "buttons": [
        { "role": "Mage", "color": "#3fc7eb", "emoji": "🧙", "label": "Mage" }
      ]
    }
  ]
}
```

Per button, only `role` is required. It is the exact Discord role name. On startup the bot creates the
role if it does not exist and, when `color` is set, forces the role to that color. Up to 25 buttons per
picker, 5 per row.

`icon` is a path relative to `config.json` (e.g. `assets/class-icons/wiki_mage.png`). On first start
the bot uploads it as an application emoji named after the role (lowercased) and shows it on the
button. Later starts reuse the existing emoji. Icons are baked into the image, so adding a new one
needs a rebuild. `emoji` wins over `icon` when both are set.

## Behaviour

- **single** mode: pressing a class removes any other class role from that picker and adds the chosen
  one in a single update. The user gets an ephemeral reply: "Your class is now **Mage**",
  "Your class changed from **Warrior** to **Mage**", or "Your class is already **Mage**".
- **multi** mode: pressing toggles the role. Reply: "Added **Tank**" or "Removed **Tank**".
- Failures are logged and the user sees "Something went wrong while changing your roles."

## Memes

Everything non-essential lives in `src/meme.ts`. Currently: any message whose letters contain
"johm" (so "Johm", "jo hm", "j-o-h-m") gets a reply of "Johm". Bot messages are ignored.

## Discord setup

Done once in the [Developer Portal](https://discord.com/developers/applications):

1. Bot tab: copy the token into `.env`. Enable **Server Members Intent** and **Message Content
   Intent** (the latter is for the meme features in `src/meme.ts`). Public Bot can stay off
   (set Installation > Install Link to None first).
2. OAuth2 > URL Generator: scopes `bot` and `applications.commands`; permissions Manage Roles,
   View Channels, Send Messages, Read Message History. Open the URL to invite the bot.
3. Server Settings > Roles: drag the bot's role above every role it manages. The bot warns at startup
   if this is wrong.

## Development

```sh
npm install
npm run inspect   # read-only: prints roles, colors, positions and channel ids
npm run dev       # build and run against the real server using .env
```
