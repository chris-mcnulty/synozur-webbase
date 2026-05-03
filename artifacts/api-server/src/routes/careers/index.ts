import { Router, type IRouter } from "express";
import jobsRouter from "./jobs";
import applicationsRouter from "./applications";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(jobsRouter);
router.use(applicationsRouter);
router.use(settingsRouter);

export default router;
