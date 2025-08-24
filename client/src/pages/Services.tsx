
import { useState } from 'react';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Service } from '@/types';

const Services = () => {
  const [services, setServices] = useState<Service[]>([
    {
      id: '1',
      name_en: 'Classic Manicure',
      price: 25,
      duration_min: 45,
      is_active: true,
      created_at: '2025-01-01T00:00:00Z'
    },
    {
      id: '2',
      name_en: 'Gel Manicure',
      price: 35,
      duration_min: 60,
      is_active: true,
      created_at: '2025-01-01T00:00:00Z'
    },
    {
      id: '3',
      name_en: 'Pedicure',
      price: 30,
      duration_min: 50,
      is_active: true,
      created_at: '2025-01-01T00:00:00Z'
    },
    {
      id: '4',
      name_en: 'Acrylic Nails',
      price: 45,
      duration_min: 90,
      is_active: true,
      created_at: '2025-01-01T00:00:00Z'
    }
  ]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newService, setNewService] = useState({
    name_en: '',
    price: 0,
    duration_min: 0
  });

  const handleAddService = () => {
    if (newService.name_en && newService.price > 0 && newService.duration_min > 0) {
      const service: Service = {
        id: Date.now().toString(),
        name_en: newService.name_en,
        price: newService.price,
        duration_min: newService.duration_min,
        is_active: true,
        created_at: new Date().toISOString()
      };
      setServices([...services, service]);
      setNewService({ name_en: '', price: 0, duration_min: 0 });
      setShowAddForm(false);
    }
  };

  const toggleServiceStatus = (id: string) => {
    setServices(services.map(service => 
      service.id === id 
        ? { ...service, is_active: !service.is_active }
        : service
    ));
  };

  const deleteService = (id: string) => {
    setServices(services.filter(service => service.id !== id));
  };

  return (
    <Layout userRole="owner">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Services Management</h1>
            <p className="text-gray-600 mt-2">Manage your nail salon services and pricing</p>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Service
          </Button>
        </div>

        {showAddForm && (
          <Card>
            <CardHeader>
              <CardTitle>Add New Service</CardTitle>
              <CardDescription>Create a new service for your nail salon</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="service-name">Service Name</Label>
                  <Input
                    id="service-name"
                    value={newService.name_en}
                    onChange={(e) => setNewService({ ...newService, name_en: e.target.value })}
                    placeholder="e.g., Classic Manicure"
                  />
                </div>
                <div>
                  <Label htmlFor="service-price">Price ($)</Label>
                  <Input
                    id="service-price"
                    type="number"
                    value={newService.price || ''}
                    onChange={(e) => setNewService({ ...newService, price: Number(e.target.value) })}
                    placeholder="25"
                  />
                </div>
                <div>
                  <Label htmlFor="service-duration">Duration (minutes)</Label>
                  <Input
                    id="service-duration"
                    type="number"
                    value={newService.duration_min || ''}
                    onChange={(e) => setNewService({ ...newService, duration_min: Number(e.target.value) })}
                    placeholder="45"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddService}>Add Service</Button>
                <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Current Services</CardTitle>
            <CardDescription>Manage your existing services</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{service.name_en}</TableCell>
                    <TableCell>${service.price}</TableCell>
                    <TableCell>{service.duration_min} min</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        service.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {service.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleServiceStatus(service.id)}
                        >
                          {service.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteService(service.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Services;
