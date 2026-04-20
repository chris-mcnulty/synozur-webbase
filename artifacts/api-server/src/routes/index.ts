import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import adminRouter from "./admin";
import assetsRouter from "./assets";
import eventsRouter from "./events";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(adminRouter);
router.use(assetsRouter);
router.use(eventsRouter);

export default router;
