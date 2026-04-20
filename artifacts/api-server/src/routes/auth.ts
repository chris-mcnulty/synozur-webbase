import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.authedUser);
});

export default router;
