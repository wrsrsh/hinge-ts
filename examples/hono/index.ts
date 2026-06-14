import { Hono } from "hono";
import { createHingeRestProxyHandler } from "hinge-ts/proxy";

const app = new Hono();

const rest = createHingeRestProxyHandler({
  cors: {
    origin: ["http://localhost:5173", "https://your-app.example"],
    credentials: true
  }
});

app.on(["OPTIONS", "POST"], "/api/hinge-proxy/request", (c) => rest(c.req.raw));

export default app;
