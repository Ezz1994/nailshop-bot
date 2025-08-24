
import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Calendar, Plus, Settings } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  userRole?: 'owner' | 'staff';
}

const Layout = ({ children, userRole = 'staff' }: LayoutProps) => {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-rose-50">
      {/* Header */}
      <header className="bg-white lovable-shadow border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-primary">💅 Nail Studio</h1>
            </div>
            
            <nav className="flex items-center space-x-2">
              <Link to="/today">
                <Button
                  variant={isActive('/today') ? 'default' : 'ghost'}
                  size="sm"
                  className="lovable-transition"
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Today
                </Button>
              </Link>
              
              <Link to="/calendar">
                <Button
                  variant={isActive('/calendar') ? 'default' : 'ghost'}
                  size="sm"
                  className="lovable-transition"
                >
                  Calendar
                </Button>
              </Link>
              
              {userRole === 'owner' && (
                <>
                  <Link to="/services">
                    <Button
                      variant={isActive('/services') ? 'default' : 'ghost'}
                      size="sm"
                      className="lovable-transition"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Services
                    </Button>
                  </Link>
                  
                  <Link to="/export">
                    <Button
                      variant={isActive('/export') ? 'default' : 'ghost'}
                      size="sm"
                      className="lovable-transition"
                    >
                      Export
                    </Button>
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;
