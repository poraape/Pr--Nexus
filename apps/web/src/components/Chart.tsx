import React from 'react';
import type { ChartData } from '../types';

const Chart: React.FC<ChartData> = ({ type, title, data, options, xAxisLabel, yAxisLabel }) => {
  const colors = [
    '#38bdf8', '#34d399', '#f87171', '#fbbf24', '#a78bfa', '#f472b6', 
    '#60a5fa', '#818cf8', '#a3e635', '#2dd4bf'
  ];

  const chartHeight = 200;
  const chartWidth = 300;
  const padding = { top: 10, right: 10, bottom: 30, left: 30 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const renderBarChart = () => {
    const maxValue = Math.max(...data.map(d => d.value), 0);

    return (
      <svg width="100%" height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}>
        {/* Y Axis Label */}
        {yAxisLabel && (
           <text x={-(chartHeight / 2)} y={10} transform="rotate(-90)" textAnchor="middle" fontSize="10" fill="#9ca3af">{yAxisLabel}</text>
        )}
        {data.map((d, i) => {
          const barHeight = maxValue > 0 ? (d.value / maxValue) * plotHeight : 0;
          const barWidth = plotWidth / data.length;
          return (
            <g key={i}>
              <rect
                x={padding.left + i * barWidth + barWidth * 0.1}
                y={padding.top + plotHeight - barHeight}
                width={barWidth * 0.8}
                height={barHeight}
                fill={d.color || colors[i % colors.length]}
              />
              <text x={padding.left + i * barWidth + barWidth / 2} y={chartHeight - 5} textAnchor="middle" fontSize="10" fill="#9ca3af">{d.label}</text>
            </g>
          );
        })}
        {/* Axes */}
        <line x1={padding.left} y1={chartHeight-padding.bottom+padding.top} x2={chartWidth-padding.right} y2={chartHeight-padding.bottom+padding.top} stroke="#4b5563" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight-padding.bottom+padding.top} stroke="#4b5563" />
        {/* X Axis Label */}
        {xAxisLabel && (
             <text x={chartWidth/2} y={chartHeight+25} textAnchor="middle" fontSize="10" fill="#9ca3af">{xAxisLabel}</text>
        )}
      </svg>
    );
  };

  const renderPieChart = () => {
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return <div className="text-center text-gray-500">Sem dados para exibir.</div>;
    
    let startAngle = 0;
    const radius = 80;
    const cx = 100, cy = 100;

    const getArcPath = (start: number, end: number) => {
      const startRad = (start * Math.PI) / 180;
      const endRad = (end * Math.PI) / 180;
      const x1 = cx + radius * Math.cos(startRad);
      const y1 = cy + radius * Math.sin(startRad);
      const x2 = cx + radius * Math.cos(endRad);
      const y2 = cy + radius * Math.sin(endRad);
      const largeArcFlag = end - start <= 180 ? 0 : 1;
      return `M ${cx},${cy} L ${x1},${y1} A ${radius},${radius} 0 ${largeArcFlag} 1 ${x2},${y2} Z`;
    };

    return (
      <div className="flex items-center flex-wrap justify-center">
        <svg width="200" height="200" viewBox="0 0 200 200">
          {data.map((d, i) => {
            const sliceAngle = (d.value / total) * 360;
            const endAngle = startAngle + sliceAngle;
            const path = getArcPath(startAngle, endAngle);
            startAngle = endAngle;
            return <path key={i} d={path} fill={d.color || colors[i % colors.length]} />;
          })}
        </svg>
        <div className="ml-4 text-xs">
          {data.map((d, i) => (
            <div key={i} className="flex items-center mb-1">
              <span className="w-3 h-3 rounded-sm mr-2 flex-shrink-0" style={{ backgroundColor: d.color || colors[i % colors.length] }}></span>
              <span>{d.label} ({(d.value / total * 100).toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  
  const renderLineChart = () => {
    if (data.length < 2) return <div className="text-center text-gray-500">Dados insuficientes para gráfico de linha.</div>;

    const maxValue = Math.max(...data.map(d => d.value));
    const minValue = Math.min(...data.map(d => d.value));
    const yRange = maxValue - minValue;
    
    const points = data.map((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * plotWidth;
        const y = padding.top + plotHeight - (yRange > 0 ? ((d.value - minValue) / yRange) * plotHeight : plotHeight / 2);
        return `${x},${y}`;
    }).join(' ');

    return (
         <svg width="100%" height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}>
            {/* Y Axis Label */}
            {yAxisLabel && (
              <text x={-(chartHeight / 2)} y={10} transform="rotate(-90)" textAnchor="middle" fontSize="10" fill="#9ca3af">{yAxisLabel}</text>
            )}
            <polyline
                fill="none"
                stroke={colors[0]}
                strokeWidth="2"
                points={points}
            />
            {data.map((d, i) => {
                 const x = padding.left + (i / (data.length - 1)) * plotWidth;
                 return <text key={i} x={x} y={chartHeight - 5} textAnchor="middle" fontSize="10" fill="#9ca3af">{d.label}</text>
            })}
             {/* Axes */}
            <line x1={padding.left} y1={chartHeight-padding.bottom+padding.top} x2={chartWidth-padding.right} y2={chartHeight-padding.bottom+padding.top} stroke="#4b5563" />
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight-padding.bottom+padding.top} stroke="#4b5563" />
            {/* X Axis Label */}
            {xAxisLabel && (
                <text x={chartWidth/2} y={chartHeight+25} textAnchor="middle" fontSize="10" fill="#9ca3af">{xAxisLabel}</text>
            )}
        </svg>
    )
  };

  const renderScatterChart = () => {
    if (data.length === 0) return <div className="text-center text-gray-500">Sem dados para exibir.</div>;
    const xValues = data.map(d => d.x ?? 0);
    const yValues = data.map(d => d.value);
    const maxX = Math.max(...xValues);
    const minX = Math.min(...xValues);
    const maxY = Math.max(...yValues);
    const minY = Math.min(...yValues);
    const xRange = maxX - minX;
    const yRange = maxY - minY;

    return (
        <svg width="100%" height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}>
            {/* Y Axis Label */}
            {yAxisLabel && (
              <text x={-(chartHeight / 2)} y={10} transform="rotate(-90)" textAnchor="middle" fontSize="10" fill="#9ca3af">{yAxisLabel}</text>
            )}
            {data.map((d, i) => {
                const cx = padding.left + (xRange > 0 ? ((d.x ?? 0) - minX) / xRange * plotWidth : plotWidth / 2);
                const cy = padding.top + plotHeight - (yRange > 0 ? (d.value - minY) / yRange * plotHeight : plotHeight / 2);
                return <circle key={i} cx={cx} cy={cy} r="3" fill={d.color || colors[i % colors.length]} />;
            })}
            {/* Axes */}
            <line x1={padding.left} y1={chartHeight-padding.bottom+padding.top} x2={chartWidth-padding.right} y2={chartHeight-padding.bottom+padding.top} stroke="#4b5563" />
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight-padding.bottom+padding.top} stroke="#4b5563" />
             {/* X Axis Label */}
             {xAxisLabel && (
                <text x={chartWidth/2} y={chartHeight+25} textAnchor="middle" fontSize="10" fill="#9ca3af">{xAxisLabel}</text>
            )}
        </svg>
    );
  };

  const renderChart = () => {
    switch (type) {
      case 'bar':
        return renderBarChart();
      case 'pie':
        return renderPieChart();
      case 'line':
        return renderLineChart();
      case 'scatter':
        return renderScatterChart();
      default:
        return <p>Tipo de gráfico desconhecido: {type}</p>;
    }
  };

  return (
    <div>
      <h4 className="text-md font-semibold text-gray-300 mb-2 text-center">{title}</h4>
      {renderChart()}
    </div>
  );
};

export default Chart;