# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>

## Wompi QA with Cloudflare Tunnel

For QA/local testing, Wompi must receive public HTTPS URLs. If you run:

```bash
cloudflared tunnel --url http://localhost:8000
```

and Cloudflare gives you `https://santa-ball-injured-upgrade.trycloudflare.com`, configure the frontend/API route environment with that same host:

```env
WOMPI_WEBHOOK_QA_OVERRIDE=false
WOMPI_URL_AUTH=https://id.wompi.sv/connect/token
WOMPI_URL_API=https://api.wompi.sv
WOMPI_REDIRECT_URL=https://santa-ball-injured-upgrade.trycloudflare.com/api/payments/wompi/close
WOMPI_WEBHOOK_URL=https://santa-ball-injured-upgrade.trycloudflare.com/api/payments/wompi/webhook
```

Use `/api/payments/wompi/*` when the tunnel points to the storefront/Next.js app. If the tunnel points directly to Strapi, use Strapi's routes instead:

```env
WOMPI_REDIRECT_URL=https://santa-ball-injured-upgrade.trycloudflare.com/api/wompi/redirect
WOMPI_WEBHOOK_URL=https://santa-ball-injured-upgrade.trycloudflare.com/api/wompi/webhook
```

Restart the app after changing the environment variables. Quick Cloudflare Tunnel URLs change every time you start a new unnamed tunnel, so update the Wompi variables whenever the generated `trycloudflare.com` host changes.

If Cloudflare logs `connect: connection refused` for `127.0.0.1:8000`, the tunnel is working but the local origin is not running on port 8000. Start the storefront on that port or point the tunnel to the running Strapi port instead, for example:

```bash
cloudflared tunnel --url http://localhost:1337
```

When the tunnel points directly to Strapi, set `WOMPI_RETURN_URL` to the storefront thank-you page URL. After Wompi calls `/api/wompi/redirect`, Strapi validates the signed redirect and forwards the shopper to `WOMPI_RETURN_URL` with order and transaction query parameters.

### Dual-tunnel QA setup

If you run one tunnel for Strapi and one tunnel for the storefront, use the Strapi tunnel for Wompi callback URLs and the storefront tunnel only as the final return page:

```bash
cloudflared tunnel --url http://localhost:1337
# example Strapi tunnel: https://compete-number-expand-kinda.trycloudflare.com

cloudflared tunnel --url http://localhost:3000
# example storefront tunnel: https://crops-sherman-output-relocation.trycloudflare.com
```

Configure the backend Wompi variables like this:

```env
WOMPI_WEBHOOK_QA_OVERRIDE=false
WOMPI_URL_AUTH=https://id.wompi.sv/connect/token
WOMPI_URL_API=https://api.wompi.sv
# Customer redirect after finishing payment in Wompi (storefront tunnel)
WOMPI_REDIRECT_URL=https://crops-sherman-output-relocation.trycloudflare.com/api/payments/wompi/close
WOMPI_RETURN_URL=https://crops-sherman-output-relocation.trycloudflare.com/checkout/gracias-por-su-compra

# Server-to-server payment confirmation (Strapi tunnel)
WOMPI_WEBHOOK_URL=https://compete-number-expand-kinda.trycloudflare.com/api/wompi/webhook
# Alternatively, you can use:
# WOMPI_STOREFRONT_URL=https://crops-sherman-output-relocation.trycloudflare.com
# WOMPI_THANK_YOU_PATH=/checkout/gracias-por-su-compra
```

With this setup, Wompi sends the shopper back to `WOMPI_REDIRECT_URL` after finishing payment. Keep this URL on the storefront `/api/payments/wompi/close` route so the frontend can run its close/thank-you flow. `WOMPI_RETURN_URL` is only the final storefront thank-you page used as Wompi's return URL/fallback; it should not replace `WOMPI_REDIRECT_URL` in the payment-link payload. Payment confirmation is handled by the Strapi webhook.

### Troubleshooting webhook 404 in the storefront terminal

If the storefront terminal logs `POST /api/payments/wompi/webhook 404`, Wompi is calling the storefront tunnel for the webhook. That endpoint must point to Strapi unless the frontend explicitly proxies it to Strapi.

Use the Strapi tunnel for the webhook:

```env
WOMPI_WEBHOOK_URL=https://compete-number-expand-kinda.trycloudflare.com/api/wompi/webhook
```

Use the storefront tunnel only for the customer redirect/return page:

```env
WOMPI_REDIRECT_URL=https://crops-sherman-output-relocation.trycloudflare.com/api/payments/wompi/close
WOMPI_RETURN_URL=https://crops-sherman-output-relocation.trycloudflare.com/checkout/gracias-por-su-compra
```

After changing these variables, restart Strapi and create a new Wompi payment link. Existing Wompi links keep the old webhook URL, so they will continue to call the wrong endpoint until a new link is generated.

If an old Wompi link already redirects to the Strapi host at `/checkout/gracias-por-su-compra`, Strapi also exposes that path as a compatibility alias for the signed Wompi redirect. It validates the Wompi hash and then forwards to the configured storefront return URL. For new links, prefer the storefront tunnel in `WOMPI_REDIRECT_URL`.

If a Wompi link was already generated with the root Strapi URL `/checkout/gracias-por-su-compra` instead of an `/api/*` route, Strapi registers a root compatibility redirect for that path during bootstrap. It forwards the full Wompi query string to `WOMPI_RETURN_URL` or to `WOMPI_STOREFRONT_URL + WOMPI_THANK_YOU_PATH`. This is only a QA safety net; the correct fix is still to generate a new link with the storefront `WOMPI_REDIRECT_URL`.
