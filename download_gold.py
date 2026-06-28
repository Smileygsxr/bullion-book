import os
import time
import subprocess
import pandas as pd
from datetime import datetime, timedelta

print("Initializing secure sequential downloader for Dukascopy...")

# Define our boundary dates
start_date = datetime(2026, 6, 25)
end_date = datetime(2026, 6, 26)

current_date = start_date
all_daily_files = []

# Create a temporary storage directory for the separate day files
os.makedirs("temp_duka", exist_ok=True)

while current_date <= end_date:
    # Skip weekends completely (Saturdays and Sundays) as the Forex market is closed
    if current_date.weekday() in [5, 6]:
        current_date += timedelta(days=1)
        continue
        
    date_str = current_date.strftime("%Y-%m-%d")
    print(f"-> Processing: {date_str}")
    
    # Run duka for just this specific individual day
    command = f"duka XAUUSD -s {date_str} -e {date_str} -c M5"
    subprocess.run(command, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # Find the newly created daily file inside the auto-generated .duka directory
    expected_file = os.path.join(".duka", f"XAUUSD-M5-{current_date.strftime('%Y_%m_%d')}-{current_date.strftime('%Y_%m_%d')}.csv")
    
    if os.path.exists(expected_file):
        # Read the file and move it safely to our temp holding folder
        df_day = pd.read_csv(expected_file)
        temp_dest = os.path.join("temp_duka", f"{date_str}.csv")
        df_day.to_csv(temp_dest, index=False)
        all_daily_files.append(temp_dest)
        # Clean up the original file inside .duka
        os.remove(expected_file)
    
    # Crucial step: Pause for 1 second to respect Dukascopy's rate limit thresholds
    time.sleep(1.0)
    current_date += timedelta(days=1)

# Step 2: Combine all safely downloaded days together
if all_daily_files:
    print("\nStitching daily chunks into a single timeline...")
    combined_df = pd.concat([pd.read_csv(f) for f in all_daily_files], ignore_index=True)
    
    # Format and shift time values directly to Johannesburg (UTC+2)
    combined_df['time'] = pd.to_datetime(combined_df['time'], format='%d.%m.%Y %H:%M:%S.%f')
    combined_df.set_index('time', inplace=True)
    
    if combined_df.index.tz is None:
        combined_df.index = combined_df.index.tz_localize('GMT')
    combined_df.index = combined_df.index.tz_convert('Africa/Johannesburg')
    
    # Save final complete dataset
    combined_df.to_csv("XAUUSD_5Min_Johannesburg.csv")
    print("\nSuccess! Final clean dataset generated: XAUUSD_5Min_Johannesburg.csv")
    
    # Clean up temporary storage assets
    for f in all_daily_files:
        os.remove(f)
    os.rmdir("temp_duka")
else:
    print("\nError: Could not retrieve daily entries. Ensure your internet connection is active.")
