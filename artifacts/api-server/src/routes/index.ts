import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import adminRouter from "./admin";
import assetsRouter from "./assets";
import eventsRouter from "./events";
import formsRouter from "./forms";
import authRouter from "./auth";
import insightsRouter from "./insights";
import cmsPostsRouter from "./cms/posts";
import cmsTaxonomyRouter from "./cms/taxonomy";
import cmsMediaRouter from "./cms/media";
import cmsCommentsRouter from "./cms/comments";
import cmsUsersRouter from "./cms/users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(adminRouter);
router.use(assetsRouter);
router.use(eventsRouter);
router.use(formsRouter);
router.use(authRouter);
router.use(insightsRouter);
router.use(cmsPostsRouter);
router.use(cmsTaxonomyRouter);
router.use(cmsMediaRouter);
router.use(cmsCommentsRouter);
router.use(cmsUsersRouter);

export default router;
