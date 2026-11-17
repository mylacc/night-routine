# Night Routine

A self-hosted nightly homework and bedtime checklist. It shows a minutes-left countdown and an ahead/behind schedule indicator, and has pause, editable task times, a kitchen-timer-style Timer view and an admin page. Progress is kept on the server, so you can switch phones mid-routine. Every open device updates live.

- **Server:** a single Node file, `server.js`, with no dependencies. It serves `public/` and keeps one JSON document in `data/state.json`.
- **Backups:** one snapshot per day goes in `data/backups/`, and the last 30 are kept (set `BACKUP_KEEP` to change).
- **Sync:** changes are saved optimistically. If two phones act at the same moment, the second phone replays its change on top of the first, so neither is lost. While the server is unreachable, changes queue on the phone and are sent once it's back. A queued change is lost if the page is reloaded before it's sent.
- **Personal settings** (page title, home-screen name, port, container name) live in `.env`, which git ignores. The code has generic defaults.

## Configure

```sh
cp .env.example .env
```

Then edit `.env`:

| Variable | What it sets | Default |
|---|---|---|
| `APP_TITLE` | Heading at the top of the page | `Homework & bedtime routine` |
| `APP_SHORT_NAME` | Browser tab and home-screen app name | `Night Routine` |
| `HOST_PORT` | Port on the host that serves the app | `8080` |
| `CONTAINER_NAME` | Docker container name | `night-routine` |

### Your task list

A new install starts with a generic example routine: Homework (Mon–Thu), Reading, Snack, Bath, Pajamas, Brush teeth, Floss and Story time. Change it on the **Admin** page (`#admin`). Your list is stored on the server, so this default only matters the first time.

In Admin, **Backup & share** lets you **Export** the list to a `.json` file and **Import** one (or paste JSON). Use it for backups, a second install, or sharing a routine. Imported lists load into the editor; nothing changes until you tap **Save**. File format:

```json
{
  "format": "night-routine-tasks",
  "version": 1,
  "tasks": [
    { "name": "Homework", "minutes": 30, "days": ["Mon", "Tue", "Wed", "Thu"] },
    { "name": "Reading",  "minutes": 20, "days": "every day" },
    { "name": "Piano",    "minutes": 15, "days": ["Tue", "Thu"], "from": "2027-01-04", "until": "2027-06-18" }
  ]
}
```

`days` is `"every day"` or a list of day names. `from` and `until` are optional dates (YYYY-MM-DD). Keep personal lists out of the repo.

## Deploy with Docker (example: Synology)

1. Copy this folder to the host, e.g. `/volume1/docker/night-routine`, and create `.env` as above.
2. SSH in and run:

   ```sh
   cd /volume1/docker/night-routine
   sudo mkdir -p data && sudo chown 1000:1000 data   # container runs as the unprivileged "node" user (uid 1000)
   sudo docker compose up -d --build                  # older DSM: sudo docker-compose up -d --build
   ```

   Or in Container Manager, go to **Project → Create**, point it at this folder, and build. Do the `chown` first either way.
3. Open `http://<host>:<HOST_PORT>`.

The image is built locally from this folder; nothing is pulled except the `node:22-alpine` base image.

## HTTPS (recommended)

Browsers only allow **Keep screen on** and **Add to Home screen as an app** over HTTPS. The simplest option on a tailnet is Tailscale Serve, which stays private to your tailnet and is not Funnel:

```sh
sudo tailscale serve --bg --https=8444 http://127.0.0.1:<HOST_PORT>
# then open https://<nas-name>.<your-tailnet>.ts.net:8444
```

On DSM the CLI may live at `/var/packages/Tailscale/target/bin/tailscale`. Each phone that uses the app needs to be on the tailnet.

**Security note:** the app has no login. Anyone who can reach the port can view and edit it. Keep it on the LAN or tailnet. Don't publish it through Funnel or a reverse proxy unless something like an OAuth gate sits in front of it.

## Updating

Replace `server.js` and `public/`, then run `sudo docker compose up -d --build`. `data/` and `.env` are untouched.

## Using it

- **Start** begins the night with the first task. You can also tap any task and choose *Start the night with this task*.
- **Any order:** tap a task to start it. Whatever was running stops and keeps the time it had so far.
- **Done** checks off the running task and starts the next unchecked one in list order. Tap a different task at any point to switch.
- **Forgot to start a task?** Tap it and type how long it has been going (e.g. `12`, `12.5`, `12:30`), then *Start this task*, *Mark done with this time*, or *Save time*. You can edit any task's time, done or not, the same way.
- **Wrong task was running?** Tap the task you were actually doing and choose *Start this, and move …'s last m:ss here*. The time since the wrong task started moves to the right one.
- **Checking a box** on a task that was never timed asks how long it took, defaulting to the planned time.
- **Pause** stops the clock between tasks. Paused time doesn't count against the schedule, but it does push back the estimated finish time.
- **Schedule math:**
  - *Minutes left* = planned minutes still remaining on unchecked tasks.
  - *Ahead/behind* = for checked tasks, actual time minus planned time; for unchecked tasks, any time beyond plan.
- **Days:** each task has the nights it runs on, set in Admin. The defaults: Math, Spelling and Fluency run Monday–Thursday only; everything else runs every night. Anything before 4 AM counts as the previous night.
- **Admin** (`#admin`): edit minutes, days, order, add or remove tasks, and set optional *From*/*Until* dates to start or stop a task on a set date. Changes apply to future nights; a night already in progress keeps its list.
- **History** (`#history`): finished nights, with each task's actual time.

## API (for scripting)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/state` | `{ state, serverTime }` |
| PUT | `/api/state` | body `{ baseRev, state }`; `409` with the current state if `baseRev` is stale |
| GET | `/api/events` | Server-Sent Events, `rev` on every change |
| GET | `/healthz` | `ok` |
