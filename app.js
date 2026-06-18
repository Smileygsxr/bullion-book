document.addEventListener("DOMContentLoaded", () => {
    const chartContainer = document.getElementById('chart-cpi-april');

    // 1. Initialize the chart layout configurations
    const chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: 400,
        layout: {
            background: { color: '#131722' },
            textColor: '#d1d4dc',
        },
        grid: {
            vertLines: { color: '#242832' },
            horzLines: { color: '#242832' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: '#2a2e39',
        },
        timeScale: {
            borderColor: '#2a2e39',
            timeVisible: true,
            secondsVisible: false,
        },
    });

    // 2. Append a Candlestick Series to the chart
    const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
    });

    // 3. Inject mock price data (Format: Year-Month-Day)
    const mockData = [
        { time: '2026-04-01', open: 100.00, high: 105.50, low: 98.22, close: 103.40 },
        { time: '2026-04-02', open: 103.40, high: 104.00, low: 101.00, close: 102.10 },
        { time: '2026-04-03', open: 102.10, high: 107.80, low: 101.50, close: 106.20 },
        { time: '2026-04-04', open: 106.20, high: 106.50, low: 102.80, close: 103.50 },
        { time: '2026-04-05', open: 103.50, high: 104.20, low: 95.00, close: 96.80 },
        { time: '2026-04-06', open: 96.80,  high: 101.00, low: 96.00,  close: 100.50 }
    ];

    candlestickSeries.setData(mockData);

    // 4. Track browser sizing modifications to make it fully responsive
    window.addEventListener('resize', () => {
        chart.resize(chartContainer.clientWidth, 400);
    });
});
