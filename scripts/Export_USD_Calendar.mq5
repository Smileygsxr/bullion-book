//+------------------------------------------------------------------+
//| Export_USD_Calendar.mq5                                          |
//|                                                                    |
//| Exports USD economic calendar events from MT5's built-in Calendar |
//| into the exact CSV format bullion-book's News page reads:        |
//|   date,time,name,actual,forecast,previous,importance              |
//| (header row, ISO date, "8:30am"-style time, one row per event)   |
//|                                                                    |
//| HOW TO RUN:                                                       |
//|   1. Open this file in MetaEditor (F4 in MT5, or double-click it  |
//|      under Navigator > Scripts once it's in your MQL5/Scripts     |
//|      folder) and press F7 to compile. Fix any errors first - this|
//|      hasn't been compile-tested, so please paste me any errors.  |
//|   2. Drag the compiled script onto any chart in MT5 (or           |
//|      double-click it in Navigator > Scripts) to run it.          |
//|   3. It writes EconomicEvents_USD.csv into your MQL5/Files folder |
//|      (File > Open Data Folder in MT5, then MQL5/Files).           |
//|   4. Copy that file into bullion-book/data/EconomicEvents.csv,    |
//|      overwriting the old one.                                    |
//|                                                                    |
//| Requires "Allow Algo/Script imports" and a live connection to your|
//| broker - the Calendar needs the terminal to actually fetch data.  |
//+------------------------------------------------------------------+
#property script_show_inputs
#property strict

input datetime FromDate = D'2026.01.01 00:00:00'; // widen/narrow to taste
input datetime ToDate   = D'2026.12.31 23:59:59';
input string   OutputFileName = "EconomicEvents_USD.csv";

//+------------------------------------------------------------------+
//| MT5 stores every calendar value as an integer scaled by a FIXED  |
//| 1,000,000 (confirmed empirically - e.g. a PMI forecast of 52.3   |
//| arrives as raw=52300000, an oil rig count of 412 arrives as      |
//| raw=412000000) - "digits" is unrelated to that scale, it's only  |
//| a display-rounding hint (how many decimals this event normally   |
//| reports). Returns "" if the value isn't set yet (event hasn't    |
//| happened / no forecast published) - MT5 uses LONG_MIN for that.  |
//+------------------------------------------------------------------+
string FormatCalendarNumber(const long raw_value, const int digits)
{
    if(raw_value == LONG_MIN) return "";
    double scaled = raw_value / 1000000.0;
    return DoubleToString(scaled, digits);
}

//+------------------------------------------------------------------+
//| MT5's TimeToString gives 24-hour "HH:MM" - convert to the         |
//| lowercase "8:30am" / "12:00pm" style the app's parser expects.   |
//+------------------------------------------------------------------+
string FormatEventTime(const datetime event_time)
{
    string time_str = TimeToString(event_time, TIME_MINUTES); // "HH:MM"
    int hour = (int)StringToInteger(StringSubstr(time_str, 0, 2));
    string minute_part = StringSubstr(time_str, 3, 2);
    string ampm = (hour >= 12) ? "pm" : "am";
    int hour12 = hour % 12;
    if(hour12 == 0) hour12 = 12;
    return IntegerToString(hour12) + ":" + minute_part + ampm;
}

//+------------------------------------------------------------------+
//| Matches MT5's own Calendar tab impact levels (None/Low/Moderate/ |
//| High) - lowercased so the app can match it directly in a class   |
//| name without any extra parsing.                                  |
//+------------------------------------------------------------------+
string FormatImportance(const ENUM_CALENDAR_EVENT_IMPORTANCE importance)
{
    switch(importance)
    {
        case CALENDAR_IMPORTANCE_HIGH:     return "high";
        case CALENDAR_IMPORTANCE_MODERATE: return "moderate";
        case CALENDAR_IMPORTANCE_LOW:      return "low";
        default:                           return "none";
    }
}

void OnStart()
{
    MqlCalendarValue values[];
    int count = CalendarValueHistory(values, FromDate, ToDate, NULL, "USD");
    if(count <= 0)
    {
        Print("No USD calendar events found for ", TimeToString(FromDate, TIME_DATE),
              " - ", TimeToString(ToDate, TIME_DATE),
              ". Check you're connected to your broker and the Calendar tab shows data.");
        return;
    }

    int handle = FileOpen(OutputFileName, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
    if(handle == INVALID_HANDLE)
    {
        Print("Could not open ", OutputFileName, " for writing. Error: ", GetLastError());
        return;
    }

    FileWrite(handle, "date", "time", "name", "actual", "forecast", "previous", "importance");

    int written = 0;
    for(int i = 0; i < count; i++)
    {
        MqlCalendarEvent event;
        if(!CalendarEventById(values[i].event_id, event)) continue;

        // Calendar times come back in broker SERVER time (GMT+0 on this
        // account) - shift +2h to match Africa/Johannesburg, same as every
        // price candle this app uses. Computed once so a late-night event
        // that rolls into the next calendar day gets the right date too.
        datetime shifted_time = values[i].time + 2 * 3600;

        string date_str = TimeToString(shifted_time, TIME_DATE); // "2026.07.03"
        StringReplace(date_str, ".", "-");                       // -> "2026-07-03"

        string time_str = FormatEventTime(shifted_time);
        string actual = FormatCalendarNumber(values[i].actual_value, event.digits);
        string forecast = FormatCalendarNumber(values[i].forecast_value, event.digits);
        string previous = FormatCalendarNumber(values[i].prev_value, event.digits);
        string importance = FormatImportance(event.importance);

        FileWrite(handle, date_str, time_str, event.name, actual, forecast, previous, importance);
        written++;
    }

    FileClose(handle);
    Print("Wrote ", written, " USD calendar event(s) to ", OutputFileName,
          " (find it via File > Open Data Folder > MQL5 > Files)");
}
