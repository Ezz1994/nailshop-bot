
import { useState } from 'react';
import Layout from '@/components/Layout';
import WeeklyCalendar from '@/components/WeeklyCalendar';

const Calendar = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());

  return (
    <Layout userRole="owner">
      <WeeklyCalendar 
        selectedDate={selectedDate} 
        onDateChange={setSelectedDate}
      />
    </Layout>
  );
};

export default Calendar;
