
import { useState } from 'react';
import Layout from '@/components/Layout';
import BookingTable from '@/components/BookingTable';

const Index = () => {
  const [selectedDate] = useState(new Date().toISOString().split('T')[0]);

  return (
    <Layout userRole="owner">
      <BookingTable selectedDate={selectedDate} />
    </Layout>
  );
};

export default Index;
