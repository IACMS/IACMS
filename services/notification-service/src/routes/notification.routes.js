import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Notification routes' });
});

export default router;

