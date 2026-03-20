import { onCLS, onINP, onLCP, onFCP, onTTFB, Metric } from 'web-vitals';

const reportWebVitals = (onPerfEntry?: (metric: Metric) => void) => {
    if (onPerfEntry && onPerfEntry instanceof Function) {
        onCLS(onPerfEntry);
        onINP(onPerfEntry);
        onLCP(onPerfEntry);
        onFCP(onPerfEntry);
        onTTFB(onPerfEntry);
    }
};

export default reportWebVitals;
