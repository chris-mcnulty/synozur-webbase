import { Router, type IRouter } from "express";
import { GetAdminMeResponse } from "@workspace/api-zod";
import { getCurrentAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/admin/me", async (req, res): Promise<void> => {
  const result = await getCurrentAdmin(req);
  if (result.status === "unauthenticated") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (result.status === "unauthorized") {
    res.status(403).json(
      GetAdminMeResponse.parse({
        userId: "",
        email: result.email,
        authorized: false,
      }),
    );
    return;
  }
  res.json(
    GetAdminMeResponse.parse({
      userId: result.info.userId,
      email: result.info.email,
      authorized: true,
    }),
  );
});

export default router;
