import { Router } from 'express';
import { getModelCatalog, publicModelCatalog } from '../services/modelCatalog';

const router = Router();

router.get('/', (_req, res, next) => {
  try {
    res.json(publicModelCatalog(getModelCatalog()));
  } catch (error) {
    next(error);
  }
});

export { router as modelRouter };
