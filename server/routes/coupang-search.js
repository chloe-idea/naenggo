import { Router } from 'express';
import { handleCoupangSearch } from '../lib/handlers/coupang-search.js';

const router = Router();

router.get('/coupang-search', async (req, res) => {
  const result = await handleCoupangSearch({
    keyword: req.query?.keyword,
  });
  return res.status(result.status).json(result.body);
});

export default router;
