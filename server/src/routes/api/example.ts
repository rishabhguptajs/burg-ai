import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Example API endpoint',
    data: {
      timestamp: new Date().toISOString(),
      endpoint: '/api/example'
    }
  });
});

router.get('/hello', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Hello from the API!',
    data: {
      greeting: 'Welcome to Burg AI Backend'
    }
  });
});

export default router;
