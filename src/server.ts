import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { attachSession } from "./middleware/auth";
import { authRouter } from "./routes/auth.routes";
import { usersRouter } from "./routes/users.routes";
import { brandsRouter } from "./routes/brands.routes";
import { uploadsRouter } from "./routes/uploads.routes";
import { qcSitesRouter } from "./routes/qc-sites.routes";
import { pipelineLeadsRouter } from "./routes/pipeline-leads.routes";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/brands", brandsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/qc-sites", qcSitesRouter);
app.use("/api/pipeline-leads", pipelineLeadsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => {
  console.log(`quickclean-backend listening on http://localhost:${port}`);
});
