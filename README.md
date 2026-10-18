# WORN

The repository contains two independent projects.

| Folder | Project | Instructions |
| --- | --- | --- |
| [web](web/) | Consumer frontend: product picker, wear slider, evidence drawer, and live camera slot | [Frontend README](web/README.md) |
| [render-lab](render-lab/) | Render lab, Decart token server, wear pipeline, and render fixtures | [Render README](render-lab/README.md) |

## Run the frontend

Use Node.js 22.6 or newer.

```sh
cd web
npm ci
npm run dev
```

## Run the render lab

Open a terminal at the repository root.

```sh
cd render-lab
npm ci
npm run dev
```

Both web apps use port 5173 by default. Run one at a time with these commands. The render server uses port 8787.

The render lab remains a standalone project. Connecting its renderer to the consumer frontend is a separate integration step. Keep frontend changes in `web/` and render changes in `render-lab/`.

Put render credentials in `render-lab/.env` using its `.env.example`. Credentials and camera uploads stay local.
