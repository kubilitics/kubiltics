import { Link, useNavigate } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold text-primary/20 mb-4">404</div>
        <h1 className="text-2xl font-semibold mb-3">Resource Not Found</h1>
        <p className="text-muted-foreground mb-8">
          The resource you're looking for doesn't exist.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-2 rounded-xl">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          <Button onClick={() => navigate('/dashboard')} className="gap-2 rounded-xl">
            <Home className="h-4 w-4" />
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
