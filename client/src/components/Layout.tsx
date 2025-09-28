
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

  // Get environment variables for dynamic content
  const appName = import.meta.env.VITE_APP_NAME || '💅 Nail Studio';
  const appLogo = import.meta.env.VITE_APP_LOGO || '💅';
  const showServicesMenu = import.meta.env.VITE_SHOW_SERVICES_MENU !== 'false';
  const showExportMenu = import.meta.env.VITE_SHOW_EXPORT_MENU !== 'false';

  return (
    <div className="min-h-screen bg-gradient-dynamic">
      {/* Header with dynamic colors */}
      <header 
        className="lovable-shadow border-b"
        style={{
          backgroundColor: `hsl(var(--header-bg))`,
          color: `hsl(var(--header-text))`
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <h1 
                className="text-2xl font-bold"
                style={{ color: `hsl(var(--header-text))` }}
              >
                {appLogo} {appName}
              </h1>
            </div>
            
            <nav className="flex items-center space-x-2">
              <Link to="/today">
                <Button
                  variant={isActive('/today') ? 'default' : 'ghost'}
                  size="sm"
                  className={`lovable-transition ${isActive('/today') ? 'nav-btn-active' : 'nav-btn-inactive'}`}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Today
                </Button>
              </Link>
              
              <Link to="/calendar">
                <Button
                  variant={isActive('/calendar') ? 'default' : 'ghost'}
                  size="sm"
                  className={`lovable-transition ${isActive('/calendar') ? 'nav-btn-active' : 'nav-btn-inactive'}`}
                >
                  Calendar
                </Button>
              </Link>
              
              {userRole === 'owner' && (
                <>
                  {showServicesMenu && (
                    <Link to="/services">
                      <Button
                        variant={isActive('/services') ? 'default' : 'ghost'}
                        size="sm"
                        className={`lovable-transition ${isActive('/services') ? 'nav-btn-active' : 'nav-btn-inactive'}`}
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        Services
                      </Button>
                    </Link>
                  )}
                  
                  {showExportMenu && (
                    <Link to="/export">
                      <Button
                        variant={isActive('/export') ? 'default' : 'ghost'}
                        size="sm"
                        className={`lovable-transition ${isActive('/export') ? 'nav-btn-active' : 'nav-btn-inactive'}`}
                      >
                        Export
                      </Button>
                    </Link>
                  )}
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
