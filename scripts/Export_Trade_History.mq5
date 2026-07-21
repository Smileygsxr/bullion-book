//+------------------------------------------------------------------+
//| Export_Trade_History.mq5                                          |
//|                                                                    |
//| Exports your closed trades from MT5 into the exact CSV format     |
//| Bullion Book's Import Trades page reads - one row per closed      |
//| position, with the broker's own reported profit/commission/swap   |
//| so your journal matches your statement to the cent.               |
//|                                                                    |
//| HOW TO RUN:                                                       |
//|   1. In MT5: File > Open Data Folder, then put this file in       |
//|      MQL5/Scripts. Open it in MetaEditor (F4) and press F7 to     |
//|      compile.                                                     |
//|   2. Drag the compiled script onto any chart (or double-click it  |
//|      under Navigator > Scripts) and set the date range.           |
//|   3. It writes BullionBook_Trades.csv into MQL5/Files             |
//|      (File > Open Data Folder, then MQL5/Files).                  |
//|   4. Upload that file in Bullion Book: Settings > Import Trades.  |
//|      Broker server time is usually GMT+2/+3 - set the Time        |
//|      Adjustment there so times match the app's GMT+2 charts.      |
//|                                                                    |
//| Partial closes are merged into one row per position using         |
//| volume-weighted average prices; positions still open are skipped. |
//+------------------------------------------------------------------+
#property script_show_inputs
#property strict

input datetime FromDate = D'2020.01.01 00:00:00'; // export trades closed after this
input datetime ToDate   = 0;                      // 0 = up to now
input string   OutputFileName = "BullionBook_Trades.csv";
// MQL scripts are sandboxed - they can only write inside the terminal's own
// folders, never a user-chosen path. true saves to the shared Common\Files
// folder (same location for every MT5 install on the PC); false saves to
// this terminal's MQL5\Files. Either way the popup shows the full path.
input bool     SaveToCommonFolder = false;

//+------------------------------------------------------------------+
//| One output row per position id, built up from its deals           |
//+------------------------------------------------------------------+
struct PositionRow
{
    long     position_id;
    string   symbol;
    long     direction;    // DEAL_TYPE_BUY / DEAL_TYPE_SELL of the first entry, -1 = unset
    double   in_volume;    // total entry lots
    double   in_value;     // sum(entry price * lots) for the volume-weighted open price
    datetime open_time;    // first entry deal's time
    double   out_volume;
    double   out_value;
    datetime close_time;   // last exit deal's time
    double   commission;
    double   swap;
    double   profit;
    double   sl;           // best-effort, from the opening order (0 = none)
    double   tp;
};

int FindRow(PositionRow &rows[], const int count, const long position_id)
{
    for(int i = 0; i < count; i++)
        if(rows[i].position_id == position_id) return i;
    return -1;
}

void OnStart()
{
    datetime to = (ToDate == 0) ? TimeCurrent() + 86400 : ToDate;
    if(!HistorySelect(FromDate, to))
    {
        Alert("Could not load trade history - is the terminal connected?");
        return;
    }

    int total = HistoryDealsTotal();
    PositionRow rows[];
    int count = 0;

    for(int i = 0; i < total; i++)
    {
        ulong ticket = HistoryDealGetTicket(i);
        if(ticket == 0) continue;

        long deal_type = HistoryDealGetInteger(ticket, DEAL_TYPE);
        if(deal_type != DEAL_TYPE_BUY && deal_type != DEAL_TYPE_SELL) continue; // skips balance ops etc.

        long     entry  = HistoryDealGetInteger(ticket, DEAL_ENTRY);
        long     pos_id = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
        double   vol    = HistoryDealGetDouble(ticket, DEAL_VOLUME);
        double   price  = HistoryDealGetDouble(ticket, DEAL_PRICE);
        datetime t      = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

        int r = FindRow(rows, count, pos_id);
        if(r < 0)
        {
            ArrayResize(rows, count + 1, 256);
            r = count++;
            rows[r].position_id = pos_id;
            rows[r].symbol      = HistoryDealGetString(ticket, DEAL_SYMBOL);
            rows[r].direction   = -1;
            rows[r].in_volume   = 0; rows[r].in_value  = 0; rows[r].open_time  = 0;
            rows[r].out_volume  = 0; rows[r].out_value = 0; rows[r].close_time = 0;
            rows[r].commission  = 0; rows[r].swap = 0; rows[r].profit = 0;
            rows[r].sl = 0; rows[r].tp = 0;
        }

        rows[r].commission += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
        rows[r].swap       += HistoryDealGetDouble(ticket, DEAL_SWAP);
        rows[r].profit     += HistoryDealGetDouble(ticket, DEAL_PROFIT);

        // Protective levels: DEAL_SL/DEAL_TP hold whatever SL/TP the position
        // had AT THE TIME of each deal. A stop set only AFTER entry (the
        // normal manual flow: open first, then set/drag stops) is 0 on the
        // entry deal and only shows up on later deals - the EXIT deal carries
        // the final levels, which is also what MT5's own History tab
        // displays. So capture from EVERY deal of the position, letting later
        // non-zero values overwrite earlier ones, with the deal's order
        // record kept as a last-resort fallback for pending-order entries.
        double deal_sl = HistoryDealGetDouble(ticket, DEAL_SL);
        double deal_tp = HistoryDealGetDouble(ticket, DEAL_TP);
        if(deal_sl <= 0 && deal_tp <= 0)
        {
            ulong src_order = (ulong)HistoryDealGetInteger(ticket, DEAL_ORDER);
            if(src_order > 0)
            {
                deal_sl = HistoryOrderGetDouble(src_order, ORDER_SL);
                deal_tp = HistoryOrderGetDouble(src_order, ORDER_TP);
            }
        }
        if(deal_sl > 0) rows[r].sl = deal_sl;
        if(deal_tp > 0) rows[r].tp = deal_tp;

        // A reversal deal (DEAL_ENTRY_INOUT) closes the old position and opens a
        // new one in a single deal - rare outside netting accounts. It's treated
        // as an entry only if this position has no entry yet, otherwise an exit.
        bool is_entry = (entry == DEAL_ENTRY_IN) || (entry == DEAL_ENTRY_INOUT && rows[r].direction == -1);
        if(is_entry)
        {
            if(rows[r].direction == -1)
            {
                rows[r].direction = deal_type;
                rows[r].open_time = t;
            }
            rows[r].in_volume += vol;
            rows[r].in_value  += vol * price;
        }
        else // DEAL_ENTRY_OUT / DEAL_ENTRY_OUT_BY / reversal exits
        {
            rows[r].out_volume += vol;
            rows[r].out_value  += vol * price;
            if(t > rows[r].close_time) rows[r].close_time = t;
        }
    }

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
    for(int i = 0; i < count; i++)
    {
        if(rows[i].direction == -1 || rows[i].in_volume <= 0 || rows[i].out_volume <= 0) continue; // still open

        int digits = (int)SymbolInfoInteger(rows[i].symbol, SYMBOL_DIGITS);
        if(digits <= 0) digits = 5;

        double open_price  = rows[i].in_value / rows[i].in_volume;
        double close_price = rows[i].out_value / rows[i].out_volume;
        double lots        = MathMin(rows[i].in_volume, rows[i].out_volume);

        string line = IntegerToString(rows[i].position_id) + ","
            + rows[i].symbol + ","
            + ((rows[i].direction == DEAL_TYPE_BUY) ? "buy" : "sell") + ","
            + DoubleToString(lots, 2) + ","
            + TimeToString(rows[i].open_time, TIME_DATE|TIME_MINUTES) + ","
            + TimeToString(rows[i].close_time, TIME_DATE|TIME_MINUTES) + ","
            + DoubleToString(open_price, digits) + ","
            + DoubleToString(close_price, digits) + ","
            + (rows[i].sl > 0 ? DoubleToString(rows[i].sl, digits) : "") + ","
            + (rows[i].tp > 0 ? DoubleToString(rows[i].tp, digits) : "") + ","
            + DoubleToString(rows[i].commission, 2) + ","
            + DoubleToString(rows[i].swap, 2) + ","
            + DoubleToString(rows[i].profit, 2) + "\n";
        FileWriteString(handle, line);
        written++;
    }

    // Currently open positions - written with blank Close Time/Close Price,
    // which Bullion Book's importer reads as a still-open trade (one leg,
    // no exit yet) instead of a closed round-trip. Profit here is floating/
    // unrealized P&L, included for reference in the file - the app doesn't
    // treat it as realized since the trade isn't closed.
    int open_written = 0;
    int total_positions = PositionsTotal();
    for(int p = 0; p < total_positions; p++)
    {
        ulong pos_ticket = PositionGetTicket(p);
        if(pos_ticket == 0 || !PositionSelectByTicket(pos_ticket)) continue;

        string  pos_symbol = PositionGetString(POSITION_SYMBOL);
        long    pos_type   = PositionGetInteger(POSITION_TYPE);
        if(pos_type != POSITION_TYPE_BUY && pos_type != POSITION_TYPE_SELL) continue;

        int digits = (int)SymbolInfoInteger(pos_symbol, SYMBOL_DIGITS);
        if(digits <= 0) digits = 5;

        double pos_sl = PositionGetDouble(POSITION_SL);
        double pos_tp = PositionGetDouble(POSITION_TP);

        string line = IntegerToString(pos_ticket) + ","
            + pos_symbol + ","
            + ((pos_type == POSITION_TYPE_BUY) ? "buy" : "sell") + ","
            + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + ","
            + TimeToString((datetime)PositionGetInteger(POSITION_TIME), TIME_DATE|TIME_MINUTES) + ","
            + "," // Close Time - blank: still open
            + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), digits) + ","
            + "," // Close Price - blank: still open
            + (pos_sl > 0 ? DoubleToString(pos_sl, digits) : "") + ","
            + (pos_tp > 0 ? DoubleToString(pos_tp, digits) : "") + ","
            + "," // Commission - MT5's position API has no running-commission field until the position closes
            + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) + ","
            + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + "\n";
        FileWriteString(handle, line);
        open_written++;
    }

    FileClose(handle);
    string full_path = SaveToCommonFolder
        ? TerminalInfoString(TERMINAL_COMMONDATA_PATH) + "\\Files\\" + OutputFileName
        : TerminalInfoString(TERMINAL_DATA_PATH) + "\\MQL5\\Files\\" + OutputFileName;
    Alert("Exported " + IntegerToString(written) + " closed trade(s) and " + IntegerToString(open_written) + " open position(s) to:\n" + full_path
        + "\n\nUpload it in Bullion Book under Settings > Import Trades.");
}
