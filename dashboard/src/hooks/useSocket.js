import { useEffect, useState } from 'react';

export default function useSocket() {
    const [events, setEvents] = useState([]);
    useEffect(() => {
        // connect to socket logic
    }, []);
    return events;
}
