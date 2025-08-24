
import { useState } from 'react';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FileText, Download, Calendar } from 'lucide-react';
import { format } from 'date-fns';

const Export = () => {
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isExporting, setIsExporting] = useState(false);

  const handleExportBookings = async () => {
    setIsExporting(true);
    
    // Simulate export process
    setTimeout(() => {
      const csvContent = `Date,Time,Service,Price,Status,Phone,Notes
2025-06-30,09:00,Classic Manicure,$25,confirmed,555-0101,Regular client
2025-06-30,10:00,Gel Manicure,$35,arrived,555-0102,First time
2025-06-30,11:30,Pedicure,$30,done,555-0103,Birthday special
2025-06-30,13:00,Acrylic Nails,$45,confirmed,555-0104,Extension needed`;

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookings-${startDate}-to-${endDate}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      setIsExporting(false);
    }, 2000);
  };

  const handleExportServices = () => {
    const csvContent = `Service Name,Price,Duration (min),Status
Classic Manicure,$25,45,Active
Gel Manicure,$35,60,Active
Pedicure,$30,50,Active
Acrylic Nails,$45,90,Active`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'services.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExportFinancialReport = async () => {
    setIsExporting(true);
    
    setTimeout(() => {
      const csvContent = `Date,Total Revenue,Bookings Count,Average Booking Value
2025-06-30,$385,12,$32.08
2025-06-29,$250,8,$31.25
2025-06-28,$180,6,$30.00
2025-06-27,$420,14,$30.00`;

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financial-report-${startDate}-to-${endDate}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      setIsExporting(false);
    }, 2000);
  };

  return (
    <Layout userRole="owner">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Data Export</h1>
          <p className="text-gray-600 mt-2">Export your business data for analysis and reporting</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Bookings Export
              </CardTitle>
              <CardDescription>
                Export booking details for a specific date range
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                onClick={handleExportBookings} 
                className="w-full gap-2"
                disabled={isExporting}
              >
                <Download className="w-4 h-4" />
                {isExporting ? 'Exporting...' : 'Export Bookings CSV'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Services Export
              </CardTitle>
              <CardDescription>
                Export your current services list and pricing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleExportServices} className="w-full gap-2">
                <Download className="w-4 h-4" />
                Export Services CSV
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Financial Report
              </CardTitle>
              <CardDescription>
                Export revenue and financial data for the selected period
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="report-start-date">Start Date</Label>
                  <Input
                    id="report-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="report-end-date">End Date</Label>
                  <Input
                    id="report-end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                onClick={handleExportFinancialReport} 
                className="w-full gap-2"
                disabled={isExporting}
              >
                <Download className="w-4 h-4" />
                {isExporting ? 'Generating...' : 'Export Financial Report'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Export Summary</CardTitle>
              <CardDescription>
                Quick stats about your exportable data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium">Total Bookings</span>
                <span className="text-lg font-bold text-primary">156</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium">Active Services</span>
                <span className="text-lg font-bold text-primary">4</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium">Monthly Revenue</span>
                <span className="text-lg font-bold text-primary">$4,680</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default Export;
