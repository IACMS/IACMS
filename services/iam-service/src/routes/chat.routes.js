import express from 'express';
import { getMessages, listColleagues, postMessage } from '../controllers/chat.controller.js';

const router = express.Router();

router.get('/colleagues', listColleagues);
router.get('/messages', getMessages);
router.post('/messages', postMessage);

export default router;
