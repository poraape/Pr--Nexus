import React, { useEffect } from 'react';
import { ErrorIcon } from './icons';

interface ToastProps {
  message: string;
  onClose: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 8000 }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      clearTimeout(timer);
    };
  }, [onClose, duration]);

  return (
    <div className="fixed bottom-5 right-5 bg-red-600 text-white py-3 px-5 rounded-lg shadow-xl flex items-center animate-fade-in-up z-50">
      <ErrorIcon className="w-6 h-6 mr-3"/>
      <p className="text-sm font-medium">{message}</p>
      <button onClick={onClose} className="ml-4 text-red-100 hover:text-white">&times;</button>
    </div>
  );
};

export default Toast;