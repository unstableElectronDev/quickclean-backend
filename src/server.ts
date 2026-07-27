import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { attachSession } from "./middleware/auth";
import { authRouter } from "./routes/auth.routes";
import { usersRouter } from "./routes/users.routes";

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

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => {
  console.log(`quickclean-backend listening on http://localhost:${port}`);
});
