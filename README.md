# Hesk Middleware

A Node.js/Express proxy that bridges the ticket submission form on the landing page to a self-hosted [Hesk](https://www.hesk.com/) helpdesk instance. Hesk doesn't expose a clean REST API for ticket creation, so this middleware handles the session management, CSRF token extraction, optional file uploads, and form submission on behalf of the frontend.

Triggered by the ticket form hosted on the [landing page](https://github.com/Treyzer567/landing-page), which is embedded as an iframe panel in Homarr.

---

## How It Works

1. Frontend submits a ticket (name, email, category, subject, message, priority, optional attachments)
2. Middleware fetches Hesk's form page to obtain a session cookie and CSRF token
3. If files are attached, they are uploaded to Hesk's async upload endpoint first
4. The full form is submitted to Hesk with the session cookie, token, and any uploaded file keys
5. The response HTML is parsed to extract the ticket tracking ID
6. The tracking ID is returned to the frontend as JSON

---

## Files

| File | Description |
|------|-------------|
| `server.js` | Main Express server — handles `/submit-ticket` POST requests |
| `package.json` | Node.js dependencies |
| `Dockerfile` | Container definition |

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/submit-ticket` | Submits a ticket to Hesk. Accepts `multipart/form-data` with fields: `name`, `email`, `category`, `subject`, `message`, `priority`, and up to 2 `attachments` |
| `GET` | `/health` | Returns service status and configured Hesk URL |

### Priority Mapping

The frontend sends text values which the middleware maps to Hesk's numeric priority system:

| Frontend | Hesk |
|----------|------|
| `low` | 3 |
| `medium` | 2 |
| `high` | 1 |
| `critical` | 0 |

---

## Deployment

Runs as a Docker container defined in `landing-compose.yml` in the [landing-page](https://github.com/Treyzer567/landing-page) repo.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HESK_URL` | Internal URL of your Hesk instance |
| `PORT` | Port the middleware listens on (default: `3001`) |
| `STATIC_DIR` | Optional path to serve static files from (e.g. the landing pages folder) |

---

## Related Repos

| Repo | Description |
|------|-------------|
| [landing-page](https://github.com/Treyzer567/landing-page) | Frontend hub — hosts the ticket submission form iframe |
