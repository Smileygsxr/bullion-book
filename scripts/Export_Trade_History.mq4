//+------------------------------------------------------------------+
//| Export_Trade_History.mq4                                          |
//|                                                                    |
//| Exports your closed trades from MT4 into the exact CSV format     |
//| Bullion Book's Import Trades page reads - one row per closed      |
//| order, with the broker's own reported profit/commission/swap so   |
//| your journal matches your statement to the cent.                  |
//|                                                                    |
//| HOW TO RUN:                                                       |
//|   1. In MT4: right-click the Account History tab and choose       |
//|      "All history" first - MT4 only exposes to scripts what that  |
//|      tab currently shows.                                         |
//|   2. File > Open Data Folder, put this file in MQL4/Scripts,      |
//|      open it in MetaEditor (F4) and press F7 to compile.          |
//|   3. Drag the compiled script onto any chart (or double-click it  |
//|      under Navigator > Scripts) and set the date range.           |
//|   4. It writes BullionBook_Trades.csv into MQL4/Files             |
//|      (File > Open Data Folder, then MQL4/Files).                  |
//|   5. Upload that file in Bullion Book: Settings > Import Trades.  |
//|      Broker server time is usually GMT+2/+3 - set the Time        |
//|      Adjustment there so times match the app's GMT+2 charts.      |
//|                                                                    |
//| Note: MT4 lists a partially-closed order as separate history      |
//| entries - each imports as its own trade, which is accurate.       |
//+------------------------------------------------------------------+
// show_inputs is the MQL4-native property name (script_show_inputs is its
// MQL5 spelling) - the classic name is honored on every MT4 build, so the
// date-range inputs dialog reliably appears before the script runs.
#property show_inputs
#property strict

input datetime FromDate = D'2020.01.01 00:00:00'; // export trades closed after this
input datetime ToDate   = 0;                      // 0 = up to now
input string   OutputFileName = "BullionBook_Trades.csv";
// MQL scripts are sandboxed - they can only write inside the terminal's own
// folders, never a user-chosen path. true saves to the shared Common\Files
// folder (same location for every MT4 install on the PC); false saves to
// this terminal's MQL4\Files. Either way the popup shows the full path.
input bool     SaveToCommonFolder = false;

void OnStart()
{
    datetime to = (ToDate == 0) ? TimeCurrent() + 86400 : ToDate;

    int open_flags = FILE_WRITE|FILE_TXT|FILE_ANSI;
    if(SaveToCommonFolder) open_flags |= FILE_COMMON;
    int handle = FileOpen(OutputFileName, open_flags);
    if(handle == INVALID_HANDLE)
    {
        Alert("Could not create " + OutputFileName + " (error " + IntegerToString(GetLastError()) + ")");
        return;
    }

    // Header names match Bullion Book's recognized import columns exactly
    FileWriteString(handle, "Ticket,Symbol,Type,Lots,Open Time,Close Time,Open Price,Close Price,Stop Loss,Take Profit,Commission,Swap,Profit\n");

    int written = 0;
    for(int i = 0; i < OrdersHistoryTotal(); i++)
    {
        if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
        if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue; // skips balance ops / pendings
        if(OrderCloseTime() == 0) continue;                           // still open
        if(OrderCloseTime() < FromDate || OrderCloseTime() > to) continue;

        int digits = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
        if(digits <= 0) digits = 5;

        string line = IntegerToString(OrderTicket()) + ","
            + OrderSymbol() + ","
            + ((OrderType() == OP_BUY) ? "buy" : "sell") + ","
            + DoubleToString(OrderLots(), 2) + ","
            + TimeToString(OrderOpenTime(), TIME_DATE|TIME_MINUTES) + ","
            + TimeToString(OrderCloseTime(), TIME_DATE|TIME_MINUTES) + ","
            + DoubleToString(OrderOpenPrice(), digits) + ","
            + DoubleToString(OrderClosePrice(), digits) + ","
            + (OrderStopLoss() > 0 ? DoubleToString(OrderStopLoss(), digits) : "") + ","
            + (OrderTakeProfit() > 0 ? DoubleToString(OrderTakeProfit(), digits) : "") + ","
            + DoubleToString(OrderCommission(), 2) + ","
            + DoubleToString(OrderSwap(), 2) + ","
            + DoubleToString(OrderProfit(), 2) + "\n";
        FileWriteString(handle, line);
        written++;
    }

    // Currently open orders - written with blank Close Time/Close Price,
    // which Bullion Book's importer reads as a still-open trade (one leg, no
    // exit yet) instead of a closed round-trip. Profit here is floating/
    // unrealized P&L, included for reference in the file - the app doesn't
    // treat it as realized since the trade isn't closed.
    int open_written = 0;
    for(int j = 0; j < OrdersTotal(); j++)
    {
        if(!OrderSelect(j, SELECT_BY_POS, MODE_TRADES)) continue;
        if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue; // skips pending orders

        int digits = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
        if(digits <= 0) digits = 5;

        string line = IntegerToString(OrderTicket()) + ","
            + OrderSymbol() + ","
            + ((OrderType() == OP_BUY) ? "buy" : "sell") + ","
            + DoubleToString(OrderLots(), 2) + ","
            + TimeToString(OrderOpenTime(), TIME_DATE|TIME_MINUTES) + ","
            + "," // Close Time - blank: still open
            + DoubleToString(OrderOpenPrice(), digits) + ","
            + "," // Close Price - blank: still open
            + (OrderStopLoss() > 0 ? DoubleToString(OrderStopLoss(), digits) : "") + ","
            + (OrderTakeProfit() > 0 ? DoubleToString(OrderTakeProfit(), digits) : "") + ","
            + DoubleToString(OrderCommission(), 2) + ","
            + DoubleToString(OrderSwap(), 2) + ","
            + DoubleToString(OrderProfit(), 2) + "\n";
        FileWriteString(handle, line);
        open_written++;
    }

    FileClose(handle);
    string full_path = SaveToCommonFolder
        ? TerminalInfoString(TERMINAL_COMMONDATA_PATH) + "\\Files\\" + OutputFileName
        : TerminalInfoString(TERMINAL_DATA_PATH) + "\\MQL4\\Files\\" + OutputFileName;
    Alert("Exported " + IntegerToString(written) + " closed trade(s) and " + IntegerToString(open_written) + " open position(s) to:\n" + full_path
        + "\n\nUpload it in Bullion Book under Settings > Import Trades.");
}
