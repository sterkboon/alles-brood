import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bakerRouter from "./baker";
import productsRouter from "./products";
import bakingDaysRouter from "./bakingDays";
import ordersRouter from "./orders";
import whatsappRouter from "./whatsapp";
import yocoRouter from "./yoco";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bakerRouter);
router.use(productsRouter);
router.use(bakingDaysRouter);
router.use(ordersRouter);
router.use(whatsappRouter);
router.use(yocoRouter);

export default router;
