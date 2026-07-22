//+------------------------------------------------------------------+
//| Export_Economic_Calendar.mq5                                     |
//|                                                                    |
//| Exports economic calendar events for the 8 major currencies      |
//| (USD, JPY, EUR, GBP, CHF, AUD, CAD, NZD) from MT5's built-in      |
//| Calendar into the exact CSV format bullion-book's News page reads|
//|   date,time,name,currency,actual,forecast,previous,importance     |
//| (header row, ISO date, "8:30am"-style time, one row per event)   |
//|                                                                    |
//| HOW TO RUN:                                                       |
//|   1. Open this file in MetaEditor (F4 in MT5, or double-click it  |
//|      under Navigator > Scripts once it's in your MQL5/Scripts     |
//|      folder) and press F7 to compile. Fix any errors first - this|
//|      hasn't been compile-tested, so please paste me any errors.  |
//|   2. Drag the compiled script onto any chart in MT5 (or           |
//|      double-click it in Navigator > Scripts) to run it.          |
//|   3. It writes EconomicEvents.csv into your MQL5/Files folder     |
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
input string   OutputFileName = "EconomicEvents.csv";

// Only these 8 major currencies are exported - narrowing here (rather than
// after fetching) skips the calendar request entirely for every other
// country, which also makes the export noticeably faster.
string MajorCurrencies[] = {"USD", "JPY", "EUR", "GBP", "CHF", "AUD", "CAD", "NZD"};

bool IsMajorCurrency(const string currency)
{
    for(int i = 0; i < ArraySize(MajorCurrencies); i++)
        if(currency == MajorCurrencies[i]) return true;
    return false;
}

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
//| Some event names contain a literal comma (e.g. "Net Debt Forecast,|
//| % GDP", "Budget Balance, Fiscal Year") - FileWrite/FILE_CSV doesn't|
//| auto-quote fields, so an unescaped comma silently splits that row |
//| into an extra column, shifting currency/actual/forecast/previous/ |
//| importance all one column to the left. Separately, this file is  |
//| written in the terminal's ANSI codepage but read by the web app as|
//| UTF-8, so any non-ASCII character (an em/en dash, curly quote,    |
//| etc.) would decode as mojibake there. Replacing anything outside  |
//| plain printable ASCII - including the comma - avoids both at once.|
//+------------------------------------------------------------------+
string SanitizeCsvField(string text)
{
    StringReplace(text, ",", " -");
    int len = StringLen(text);
    for(int i = 0; i < len; i++)
    {
        ushort ch = StringGetCharacter(text, i);
        if(ch < 32 || ch > 126) StringSetCharacter(text, i, '-');
    }
    return text;
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

//+------------------------------------------------------------------+
//| MT5's calendar module fetches data from the trade server in the  |
//| background the first time something outside what's already      |
//| cached is requested - CalendarCountries/CalendarValueHistory     |
//| return error 5401 immediately while that fetch is still in       |
//| flight instead of blocking until it's done (confirmed: even the  |
//| filter-less CalendarCountries() call hit this, which rules out   |
//| "too much data in one call" as the cause). Retrying after a      |
//| short pause lets the background sync catch up.                  |
//+------------------------------------------------------------------+
bool WaitForCalendarCountries(MqlCalendarCountry &countries[], int &total)
{
    for(int attempt = 0; attempt < 20; attempt++)
    {
        ResetLastError();
        total = CalendarCountries(countries);
        if(total > 0) return true;
        Sleep(1000);
    }
    return false;
}

int CalendarValueHistoryWithRetry(MqlCalendarValue &values[], const string country_code)
{
    for(int attempt = 0; attempt < 5; attempt++)
    {
        ResetLastError();
        int count = CalendarValueHistory(values, FromDate, ToDate, country_code, NULL);
        if(count > 0) return count;
        if(count == 0 && GetLastError() == 0) return 0; // genuinely no events for this country - not an error
        Sleep(1000);
    }
    return 0;
}

void OnStart()
{
    MqlCalendarCountry countries[];
    int countryTotal = 0;
    if(!WaitForCalendarCountries(countries, countryTotal))
    {
        Print("Could not list calendar countries after retrying for ~20 seconds. GetLastError=", GetLastError(),
              ". Open the Calendar tab in the Toolbox (Ctrl+T) and check it shows events there too - ",
              "if it's still empty/blank in the terminal itself after waiting a bit (not just this script), ",
              "your broker's server doesn't relay MT5's built-in Economic Calendar at all, which no script can work around.");
        return;
    }

    int handle = FileOpen(OutputFileName, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
    if(handle == INVALID_HANDLE)
    {
        Print("Could not open ", OutputFileName, " for writing. Error: ", GetLastError());
        return;
    }

    FileWrite(handle, "date", "time", "name", "currency", "actual", "forecast", "previous", "importance");

    int written = 0;
    int countriesWithData = 0;
    for(int c = 0; c < countryTotal; c++)
    {
        if(!IsMajorCurrency(countries[c].currency)) continue;

        MqlCalendarValue values[];
        int count = CalendarValueHistoryWithRetry(values, countries[c].code);
        if(count <= 0) continue; // no events in range for this country - not an error
        countriesWithData++;

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

            FileWrite(handle, date_str, time_str, SanitizeCsvField(event.name), countries[c].currency, actual, forecast, previous, importance);
            written++;
        }
    }

    FileClose(handle);
    Print("Wrote ", written, " calendar event(s) across ", countriesWithData,
          " countries (USD/JPY/EUR/GBP/CHF/AUD/CAD/NZD) to ", OutputFileName,
          " (find it via File > Open Data Folder > MQL5 > Files)");
}
