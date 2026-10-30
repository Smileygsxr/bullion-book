// ==== Economic calendar explanations (Charts page "?") ====
// Plain-English summaries of what each calendar release measures and how it
// usually moves its currency, shown when you click the "?" next to an event
// (openNewsEventInfo in app.js). The calendar lists 600+ distinct event
// names, which fall into the families below - each is matched by name and
// filled in with the event's country and currency.
//
// `higher` says what a higher-than-expected reading usually means for the
// currency: 'up' (stronger), 'down' (weaker - unemployment, jobless claims,
// government borrowing...) or null (no consistent direction - speeches,
// holidays, oil inventories...). The beat/miss colours and the direction
// hint use the same answer (eventPolarity in app.js), so the "?" never
// contradicts the numbers next to it. A general guide, not a prediction.

const EVENT_CURRENCIES = {
    USD: { region: 'the United States', adj: 'US', currencyName: 'US dollar', bank: 'the Federal Reserve' },
    EUR: { region: 'the euro area', adj: 'euro-area', currencyName: 'euro', bank: 'the European Central Bank' },
    GBP: { region: 'the United Kingdom', adj: 'UK', currencyName: 'pound', bank: 'the Bank of England' },
    JPY: { region: 'Japan', adj: 'Japanese', currencyName: 'yen', bank: 'the Bank of Japan' },
    CHF: { region: 'Switzerland', adj: 'Swiss', currencyName: 'Swiss franc', bank: 'the Swiss National Bank' },
    AUD: { region: 'Australia', adj: 'Australian', currencyName: 'Australian dollar', bank: 'the Reserve Bank of Australia' },
    CAD: { region: 'Canada', adj: 'Canadian', currencyName: 'Canadian dollar', bank: 'the Bank of Canada' },
    NZD: { region: 'New Zealand', adj: 'New Zealand', currencyName: 'New Zealand dollar', bank: 'the Reserve Bank of New Zealand' },
    CNY: { region: 'China', adj: 'Chinese', currencyName: 'yuan', bank: "the People's Bank of China" }
};

// Euro-area data comes from several countries. The calendar export's
// country column says which (newer exports); otherwise a few names give it away.
const EVENT_EURO_MEMBERS = { Germany: 'German', France: 'French', Italy: 'Italian', Spain: 'Spanish', Netherlands: 'Dutch', Austria: 'Austrian', Belgium: 'Belgian', Ireland: 'Irish', Portugal: 'Portuguese', Greece: 'Greek', Finland: 'Finnish' };

const EVENT_EURO_NAME_HINTS = [
    [/\b(Ifo|GfK|Bbk)\b|German/i, 'Germany'],
    [/\b(BTP|BOT|CTZ)\b|Liberation Day|Republic Day/i, 'Italy'],
    [/\b(OAT|BTF)\b|Bastille|Armistice|Victory Day/i, 'France'],
    [/Bonos|Obligacion|Letras|Fiesta Nacional/i, 'Spain']
];

// Central banks named at the start of an event ("ECB President Lagarde Speech")
const EVENT_BANK_PREFIXES = [
    [/^(Fed|FOMC)\b/, 'the Federal Reserve'], [/^ECB\b/, 'the European Central Bank'], [/^BoE\b/, 'the Bank of England'],
    [/^BoJ\b/, 'the Bank of Japan'], [/^SNB\b/, 'the Swiss National Bank'], [/^RBA\b/, 'the Reserve Bank of Australia'],
    [/^RBNZ\b/, 'the Reserve Bank of New Zealand'], [/^BoC\b/, 'the Bank of Canada'], [/^PBC\b/, "the People's Bank of China"],
    [/^Bbk\b/, "the Bundesbank (Germany's central bank)"]
];

function eventCap(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// Who/where an event is about: region names, the currency's name, its central bank
function eventPlace(name, currency, country) {
    const base = EVENT_CURRENCIES[currency]
        || { region: country || 'this economy', adj: country || 'local', currencyName: currency || 'the currency', bank: 'the central bank' };
    const place = Object.assign({ cur: currency || 'the currency' }, base);
    if (currency === 'EUR') {
        let member = country && EVENT_EURO_MEMBERS[country] ? country : null;
        if (!member && !country) {
            const hint = EVENT_EURO_NAME_HINTS.find(([pattern]) => pattern.test(name));
            if (hint) member = hint[1];
        }
        if (member) Object.assign(place, { region: member, adj: EVENT_EURO_MEMBERS[member] });
    } else if (country && !EVENT_CURRENCIES[currency]) {
        place.region = country;
    }
    const bank = EVENT_BANK_PREFIXES.find(([pattern]) => pattern.test(name));
    if (bank) place.bank = bank[1];
    place.Region = eventCap(place.region);
    place.regionPos = /s$/.test(place.region) ? `${place.region}'` : `${place.region}'s`;
    place.Bank = eventCap(place.bank);
    return place;
}

// The event families, most specific first - the first match wins.
// text(c, name) explains the release; effect(c) only where higher is null.
const ECONOMIC_EVENT_TOPICS = [
    // ---- No data: holidays ------------------------------------------------
    {
        test: /\b(Day|Birthday|Holiday|Festival|Christmas|Easter|Good Friday|Whit Monday|Maundy Thursday|Matariki|Assumption of Mary|Immaculate Conception|Fiesta Nacional)\b/i,
        higher: null,
        text: c => `A public holiday in ${c.region === 'the euro area' ? 'one or more euro-area countries' : c.region}: banks and local markets are closed and no economic data comes out.`,
        effect: c => `There's no figure to beat or miss - but with ${c.adj} traders away, ${c.cur} pairs often trade thinly, so spreads can widen and moves can be jumpy.`
    },

    // ---- Central banks ------------------------------------------------------
    {
        test: /MPC Vote (Cut|Hike|Unchanged)/i,
        higher: name => (/Hike/i.test(name) ? 'up' : /Cut/i.test(name) ? 'down' : null),
        text: (c, name) => `How many of the nine members of the Bank of England's Monetary Policy Committee voted to ${/Cut/i.test(name) ? 'cut' : /Hike/i.test(name) ? 'raise' : 'hold'} interest rates at this meeting. The split shows how close the committee is to its next move - more votes to raise (or fewer to cut) is "hawkish".`,
        effect: () => 'Which way this pushes the pound depends on how the other members voted - more votes leaning toward higher rates tends to support it.'
    },
    {
        test: /Deposit Facility Rate/i,
        higher: 'up',
        text: () => 'The interest rate banks earn on money they leave overnight at the European Central Bank - in practice the ECB\'s main policy rate. A hike (or hints of one) makes euro deposits pay more and attracts foreign money; the press conference that follows explains the decision.'
    },
    {
        test: /Marginal Lending Facility Rate/i,
        higher: 'up',
        text: () => 'The rate the European Central Bank charges banks to borrow overnight - the top of its interest-rate corridor. It moves together with the ECB\'s other key rates, so it\'s read the same way as the main decision.'
    },
    {
        test: /Interest Rate Decision|Rate Decision/i,
        higher: 'up',
        text: c => `${c.Bank} sets its main interest rate - the cost of borrowing across ${c.region}. Higher rates make ${c.cur} deposits and bonds pay more, attracting foreign money. Markets react most to surprises, and to the statement and press conference that explain what comes next.`
    },
    {
        test: /Financial Stability|FPC Meeting Minutes/i,
        higher: null,
        text: c => `${c.Bank}'s assessment of risks to the financial system - banks, debt levels, housing and markets.`,
        effect: c => `It's about stability rather than interest rates, so the ${c.currencyName} usually reacts only if it flags serious stress or a policy change.`
    },
    {
        test: /Minutes|Meeting Accounts|Summary of Opinions/i,
        higher: null,
        text: c => `A detailed record of ${c.bank}'s last policy meeting, published a few weeks later. It shows how officials weighed inflation against growth, and how united they were.`,
        effect: c => `No number to beat: signs that more officials lean toward higher rates ("hawkish") tend to support ${c.cur}; a "dovish" tilt tends to weigh on it.`
    },
    {
        test: /NBS Press Conference/i,
        higher: null,
        text: () => 'China\'s National Bureau of Statistics briefs reporters on the latest economic data and conditions.',
        effect: () => 'Its tone on growth can move the yuan - and commodity-linked currencies such as the Australian and New Zealand dollars.'
    },
    {
        test: /Non-monetary Policy Meeting/i,
        higher: null,
        text: () => 'A European Central Bank Governing Council meeting on matters other than interest rates - banking supervision, payments and operations.',
        effect: () => 'No rate decision is made, so the euro rarely reacts.'
    },
    {
        test: /FOMC Statement|Rate Statement|Monetary Policy Statement|Press Conference|News Conference|Monetary Policy Assessment/i,
        higher: null,
        text: c => `${c.Bank} explains its latest interest-rate decision and how it sees inflation and growth. Traders comb every line for hints about the next move - this often moves the market more than the decision itself.`,
        effect: c => `There's no number to beat: a more "hawkish" tone (higher rates ahead) usually supports ${c.cur}, a "dovish" one usually weighs on it.`
    },
    {
        test: /Beige Book/i,
        higher: null,
        text: () => 'The Federal Reserve\'s round-up of business conditions across its 12 regional districts, based on conversations with businesses and community contacts. It comes out two weeks before each Fed policy meeting.',
        effect: () => 'Reports of strong demand or rising wages and prices tend to support the US dollar; widespread weakness tends to weigh on it.'
    },
    {
        test: /Bulletin|Chart Pack|Monthly Report/i,
        higher: null,
        text: c => `A regular research publication from ${c.bank} - articles and charts on the economy and financial markets.`,
        effect: c => `It rarely contains policy news, so ${c.cur} seldom reacts.`
    },
    {
        test: /Monetary Policy Report|Outlook Report|Economic Projections/i,
        higher: null,
        text: (c, name) => `${c.Bank}'s updated forecasts for growth, inflation and jobs${/Projections/i.test(name) ? ' - including where Fed officials expect interest rates to go (the "dot plot")' : ''}.`,
        effect: c => `Higher inflation or growth forecasts suggest rates stay higher for longer, which tends to support ${c.cur}; downgrades tend to weigh on it.`
    },
    {
        test: /Bank Lending Survey|Credit Conditions Survey|Liabilities Survey|Senior Loan Officer/i,
        higher: null,
        text: c => `A survey of banks in ${c.region} on how easy or hard they're making it to borrow, and how much demand for loans they're seeing.`,
        effect: c => `Tighter lending points to slower growth ahead, which can weigh on ${c.cur}; easier credit supports spending and investment.`
    },
    {
        test: /Business Outlook Survey/i,
        higher: null,
        text: () => 'The Bank of Canada\'s quarterly survey of around 100 businesses on sales, investment, hiring and price expectations - a direct input into its rate decisions.',
        effect: () => 'Stronger expectations (and higher expected inflation) tend to support the Canadian dollar.'
    },
    {
        test: /Speech|Speaks|Testimony/i,
        higher: null,
        text: (c, name) => {
            const speaker = name.replace(/\s*(Speech|Speaks|Testimony)\s*$/i, '');
            const head = /^(Fed Chair|ECB President|BoE Governor|BoJ Governor|SNB Chairman|RBA Governor|RBNZ Governor|BoC Governor)\b/.test(speaker);
            return `${speaker} speaks in public${head ? ' - as head of the central bank, the most market-moving voice there is' : ''}. Policymakers' comments on inflation, growth and interest rates can move the currency on their own.`;
        },
        effect: c => `No number to beat: hints at higher rates ("hawkish") usually support ${c.cur}, hints at cuts ("dovish") usually weaken it.`
    },

    // ---- Politics & public finances ---------------------------------------
    {
        test: /EU Leaders Summit/i,
        higher: null,
        text: () => 'The heads of government of the EU countries meet to set policy on issues such as the budget, trade, energy and crises.',
        effect: () => 'The euro usually reacts only when big decisions - or clashes - are on the table.'
    },
    {
        test: /Eurogroup Meeting/i,
        higher: null,
        text: () => 'Finance ministers of the euro-area countries meet to coordinate budgets and discuss the economy.',
        effect: () => 'Rarely moves the euro unless a member country\'s finances are in the spotlight.'
    },
    {
        test: /Budget Release|Forecast Statement|Budget Statement/i,
        higher: null,
        text: c => `The government of ${c.region} presents its tax and spending plans, with official forecasts for growth and borrowing.`,
        effect: c => `Plans seen as credible tend to support the ${c.currencyName}; big unfunded spending or worse borrowing forecasts can weigh on it.`
    },
    {
        test: /SECO Economic Forecasts/i,
        higher: null,
        text: () => 'The Swiss State Secretariat for Economic Affairs (SECO) updates its forecasts for Swiss growth, inflation and unemployment.',
        effect: () => 'Upgrades tend to support the Swiss franc, downgrades weigh on it.'
    },
    {
        test: /OBEGAL|Net Debt Forecast/i,
        higher: null,
        text: () => 'The New Zealand Treasury\'s forecast for the government\'s finances - OBEGAL is its operating balance (surplus or deficit); net debt is shown as a share of GDP. Published with the Budget and the half-year update.',
        effect: () => 'Usually a minor mover for the New Zealand dollar.'
    },
    {
        test: /Public Sector Net (Borrowing|Cash Requirement)/i,
        higher: 'down',
        text: (c, name) => `How much the UK government had to borrow over the month${/Cash/i.test(name) ? ' in cash terms' : ''} to cover the gap between what it spends and what it collects. Heavier borrowing strains the public finances.`
    },
    {
        test: /Government Deficit/i,
        higher: null,
        text: c => `The government budget deficit of ${c.region} as a share of its economy (GDP).`,
        effect: c => `A smaller deficit points to healthier public finances - mildly supportive for the ${c.currencyName} - but this is rarely a market mover.`
    },
    {
        test: /Budget Balance|Government Budget/i,
        higher: 'up',
        text: c => `The government's budget position in ${c.region} - what it collected minus what it spent over the period. A positive number is a surplus, a negative one a deficit; healthier public finances are mildly supportive for the currency.`
    },

    // ---- Markets: bonds, positioning, commodities ---------------------------
    {
        test: /Auction/i,
        higher: null,
        text: (c, name) => {
            const tenor = (name.match(/^(\d+)-(Year|Month|Week)/i) || []).slice(1).join('-').toLowerCase();
            const linked = /TIPS/i.test(name) ? ' inflation-protected' : '';
            // (the euro area has no single government - a member state issues)
            const seller = c.region === 'the euro area' ? 'A euro-area government' : `The government of ${c.region}`;
            return `${seller} sells ${tenor ? `${tenor}${linked}` : `new${linked}`} debt to investors; the figure shown is usually the average yield (interest rate) accepted. Demand, and how the yield compares with recent auctions, hints at how investors see the outlook and interest rates.`;
        },
        effect: c => `Usually a minor mover - a much higher yield can attract buyers of the ${c.currencyName}, while weak demand can unsettle markets.`
    },
    {
        test: /CFTC/i,
        higher: null,
        text: (c, name) => {
            const asset = name.replace(/^CFTC\s+/i, '').replace(/\s+Non-Commercial Net Positions$/i, '');
            return `The CFTC's weekly Commitments of Traders report: how many more contracts speculators (hedge funds and other large non-commercial traders) hold long than short in ${asset} futures, as of the Tuesday before. A growing net long means rising bullish bets; an extreme reading can mean the trade is crowded.`;
        },
        effect: () => 'It\'s released on Friday about data from Tuesday, so it\'s old news and rarely moves price - it\'s more useful as background on positioning.'
    },
    {
        test: /Baker Hughes/i,
        higher: null,
        text: (c, name) => `A weekly count of rigs actively drilling for ${/Oil/i.test(name) ? 'oil' : 'oil and gas'} in the United States - a gauge of future production.`,
        effect: () => 'More rigs point to more supply later, which tends to weigh on oil prices (UKOIL); fewer rigs tend to support them. Currencies rarely react.'
    },
    {
        test: /EIA Short-Term Energy Outlook/i,
        higher: null,
        text: () => 'The US Energy Information Administration\'s monthly forecasts for oil, gas and power supply, demand and prices.',
        effect: () => 'Can move oil prices (UKOIL) if the outlook shifts sharply; currencies rarely react.'
    },
    {
        test: /EIA Natural Gas Storage/i,
        higher: null,
        text: () => 'The weekly change in natural gas held in underground storage in the United States.',
        effect: () => 'A bigger build (or smaller draw) than expected tends to weigh on gas prices. Currencies rarely react.'
    },
    {
        test: /EIA (Cushing )?Crude Oil Stocks/i,
        higher: null,
        text: (c, name) => `The weekly change in US commercial crude oil inventories, in barrels, from the Energy Information Administration${/Cushing/i.test(name) ? ' - here at Cushing, Oklahoma, the delivery point for US oil futures' : ''}.`,
        effect: () => 'A bigger build than expected signals weak demand or plentiful supply and tends to push oil (UKOIL) lower; a draw tends to lift it. The Canadian dollar often follows oil.'
    },
    {
        test: /EIA .*Stocks/i,
        higher: null,
        text: (c, name) => `The weekly change in US inventories of ${/Gasoline/i.test(name) ? 'gasoline' : /Heating/i.test(name) ? 'heating oil' : 'distillates (diesel and heating oil)'}, from the Energy Information Administration.`,
        effect: () => 'Builds suggest weaker fuel demand, which tends to weigh on oil (UKOIL); draws the opposite.'
    },
    {
        test: /^EIA /i,
        higher: null,
        text: () => 'Weekly US oil supply data from the Energy Information Administration - refinery activity, production or imports.',
        effect: () => 'Watched by oil traders as a read on supply and demand; currencies rarely react.'
    },
    {
        test: /WASDE/i,
        higher: null,
        text: () => 'The US Department of Agriculture\'s monthly World Agricultural Supply and Demand Estimates for crops such as corn, wheat and soybeans.',
        effect: () => 'It moves grain prices; major currencies rarely react.'
    },

    // ---- Inflation -----------------------------------------------------------
    {
        test: /Inflation Expectations|Price Expectations/i,
        higher: 'up',
        text: (c, name) => {
            if (/Selling Price/i.test(name)) {
                return `How many companies in ${c.region} expect to raise their selling prices in the coming months, minus those expecting to cut them - an early signal of where inflation is heading.`;
            }
            const who = /Michigan/i.test(name) ? 'US consumers (University of Michigan survey)'
                : /^MI\b/.test(name) ? 'Australian consumers (Melbourne Institute survey)'
                    : /RBNZ/i.test(name) ? 'New Zealand business managers and economists'
                        : `consumers in ${c.region}`;
            const horizon = (name.match(/(\d+)-Year/i) || [])[1];
            return `How much inflation ${who} expect${horizon ? ` over the next ${horizon} years` : ' in the year ahead'}. Expectations can become self-fulfilling - wages and prices get set with them in mind - so central banks watch them closely.`;
        }
    },
    {
        test: /PCE Price Index|PCE Inflation/i,
        higher: 'up',
        text: (c, name) => `The Personal Consumption Expenditures price index - the change in prices of everything US households spend on, and the Federal Reserve's preferred inflation measure${/Core/i.test(name) ? '. "Core" leaves out volatile food and energy prices to show the underlying trend' : /Trimmed/i.test(name) ? '. The Dallas Fed\'s trimmed-mean version drops the most extreme price changes each month' : ''}. Hotter inflation keeps interest rates higher for longer.`
    },
    {
        test: /Core CPI|CPI excl\. (Food|Energy)|Trimmed|Median CPI|Weighted Median|Common CPI/i,
        higher: 'up',
        text: (c, name) => `A "core" measure of consumer inflation in ${/Tokyo/i.test(name) ? 'Tokyo' : c.region} - it strips out volatile items such as food and energy (or the most extreme price changes) to show the underlying trend, which central banks watch most closely.${/Tokyo/i.test(name) ? ' Tokyo\'s figure comes out weeks before the national one, so it\'s an early read on Japanese inflation.' : ''} Higher inflation makes rate rises more likely (or cuts less likely).`
    },
    {
        test: /\bCPIH?\b|HICP|Consumer Price Index/i,
        higher: 'up',
        text: (c, name) => {
            let note = '';
            if (/Tokyo/i.test(name)) note = ' Tokyo\'s figure comes out weeks before the national one, so it\'s an early read on Japanese inflation.';
            else if (/HICP/i.test(name)) note = ' HICP is the EU-wide "harmonised" version - the measure the ECB targets.';
            else if (/CPIH/i.test(name)) note = ' CPIH also includes the housing costs of people who own their homes.';
            else if (/Tobacco/i.test(name)) note = ' This version leaves out tobacco.';
            return `The Consumer Price Index - the change in prices of a typical basket of goods and services bought by households in ${/Tokyo/i.test(name) ? 'Tokyo' : c.region}, and the main measure of inflation.${note} Higher inflation makes interest-rate rises more likely (or cuts less likely).`;
        }
    },
    {
        test: /\bRPI\b/i,
        higher: 'up',
        text: () => 'The UK Retail Price Index - an older inflation measure that also includes mortgage interest payments. It\'s still used in some wage deals and index-linked bonds.'
    },
    {
        test: /\bPPI\b|Producer Price|IPPI|RMPI|Wholesale Price Index|Corporate (Goods|Services) Price/i,
        higher: 'up',
        text: (c, name) => {
            const what = /Input|RMPI/i.test(name) ? 'businesses pay for raw materials and energy'
                : /Services/i.test(name) ? 'companies charge each other for services'
                    : /Wholesale/i.test(name) ? 'wholesalers charge'
                        : 'producers get for the goods they sell (factory-gate prices)';
            return `The change in prices ${what} in ${c.region}. Producers' costs tend to reach shoppers later, so this is an early warning for consumer inflation.`;
        }
    },
    {
        test: /Import Price Index/i,
        higher: 'up',
        text: c => `The change in prices of goods imported into ${c.region}. Pricier imports feed into consumer inflation - which raises the chance of higher interest rates.`
    },
    {
        test: /Export Price Index/i,
        higher: 'up',
        text: c => `The change in prices of goods ${c.region} sells abroad. Higher export prices mean bigger earnings for ${c.adj} exporters and, often, more inflation pressure at home.`
    },
    {
        test: /GDP (Price|Chain Price|Implicit Price) Index|GDP Price/i,
        higher: 'up',
        text: c => `Inflation across the whole economy of ${c.region}, measured inside the GDP report (the GDP "deflator") - broader than consumer prices alone.`
    },
    {
        test: /Food Price Index/i,
        higher: 'up',
        text: c => `The monthly change in food prices in ${c.region} - a big part of the consumer price basket, so an early hint of where inflation is heading.`
    },
    {
        test: /GDT Price Index/i,
        higher: 'up',
        text: () => 'The result of the Global Dairy Trade auction, held twice a month. Dairy is New Zealand\'s biggest export, so higher prices mean bigger export earnings.'
    },
    {
        test: /Commodit(y|ies) Price/i,
        higher: 'up',
        text: c => `Prices of ${c.regionPos} main commodity exports. Higher prices mean bigger export earnings - more foreign money coming in to buy the ${c.currencyName}.`
    },
    {
        test: /\bHPI\b|House Price|Housing Price/i,
        higher: 'up',
        text: (c, name) => {
            const what = /Halifax/i.test(name) ? 'Halifax\'s index of UK house prices (from its own mortgage approvals)'
                : /Nationwide/i.test(name) ? 'Nationwide\'s index of UK house prices (from its own mortgage approvals)'
                    : /S&P\/CS/i.test(name) ? 'The S&P CoreLogic Case-Shiller index of home prices in 20 major US cities'
                        : /RICS/i.test(name) ? 'A survey of UK chartered surveyors on house prices - the share seeing prices rise minus the share seeing them fall'
                            : /New Housing/i.test(name) ? `The change in prices of newly built homes in ${c.region}`
                                : `The change in house prices in ${c.region}`;
            return `${what}. Rising prices boost household wealth and confidence (and can add to inflation pressure).`;
        }
    },

    // ---- Wages & productivity -----------------------------------------------
    {
        test: /Earnings|Wage|Labou?r Cost|Employment Cost|Unit Labor Costs|Overtime Pay|Employment Benefits/i,
        higher: 'up',
        text: (c, name) => {
            const what = /Unit Labor/i.test(name) ? 'the labour cost of producing each unit of output'
                : /Cost|Benefits/i.test(name) ? 'employers\' labour costs - wages plus benefits'
                    : /Real/i.test(name) ? 'workers\' pay after inflation'
                        : /Overtime/i.test(name) ? 'overtime pay' : 'workers\' pay';
            return `How fast ${what} is rising in ${c.region}. Faster pay growth supports spending but can also keep inflation high - so central banks watch it closely.`;
        }
    },
    {
        test: /Productivity/i,
        higher: 'up',
        text: c => `Output per hour worked in ${c.region}. Higher productivity lets the economy grow without as much inflation and lifts living standards over time.`
    },

    // ---- Jobs ------------------------------------------------------------------
    {
        test: /ADP/i,
        higher: 'up',
        text: () => 'Payroll processor ADP\'s estimate of how many private-sector jobs the US added last month, based on its clients\' payrolls. It comes out two days before the official jobs report and is watched as a hint - though the two often differ.'
    },
    {
        test: /Payrolls/i,
        higher: 'up',
        text: (c, name) => {
            if (/Government/i.test(name)) return 'The change in the number of US government jobs last month - part of the official monthly jobs report.';
            if (/Manufacturing/i.test(name)) return 'The change in the number of US factory jobs last month - part of the official monthly jobs report.';
            if (/Private/i.test(name)) return 'The change in the number of US private-sector jobs last month (leaving out government hiring) - part of the official jobs report.';
            if (c.cur !== 'USD') return `The change in the number of payroll jobs in ${c.region}.`;
            return 'Nonfarm Payrolls - how many jobs the US economy added last month (leaving out farm workers and a few other groups), from the official monthly jobs report. One of the most market-moving releases of all: it can move the US dollar and gold sharply.';
        }
    },
    {
        test: /U6 Unemployment Rate/i,
        higher: 'down',
        text: () => 'A broader US jobless rate that also counts discouraged workers who\'ve stopped looking and people working part-time who want full-time work.'
    },
    {
        test: /Unemployment Rate/i,
        higher: 'down',
        text: c => `The share of ${c.regionPos} labour force - everyone working or actively looking for work - who are unemployed. A rising rate means a cooling economy and less spending power for households; a falling rate means the opposite.`
    },
    {
        test: /Claimant Count/i,
        higher: 'down',
        text: () => 'The monthly change in the number of people in the UK claiming unemployment-related benefits - an early read on job losses.'
    },
    {
        test: /Unemployment|Jobseekers/i,
        higher: 'down',
        text: (c, name) => `${/Change/i.test(name) ? 'The change in the number' : 'The number'} of people registered as unemployed or looking for work in ${c.region}. More jobless people than expected is a sign of a weakening economy.`
    },
    {
        test: /Jobless Claims/i,
        higher: 'down',
        text: (c, name) => (/Continuing/i.test(name)
            ? 'The number of people still receiving US unemployment benefits - a rising figure means laid-off workers are finding it harder to get new jobs.'
            : `The number of people who filed for US unemployment benefits for the first time last week${/Average/i.test(name) ? ', averaged over four weeks to smooth out the noise' : ''} - the most up-to-date read on layoffs.`)
    },
    {
        test: /Job Cuts/i,
        higher: 'down',
        text: () => 'Job cuts announced by US employers during the month, tallied by outplacement firm Challenger, Gray & Christmas - more announced layoffs point to a softening job market.'
    },
    {
        test: /JOLTS/i,
        higher: 'up',
        text: () => 'The Job Openings and Labor Turnover Survey - how many jobs were unfilled in the US at the end of the month before last. More openings mean strong demand for workers (and pressure on wages).'
    },
    {
        test: /Employment Change|Employment Level/i,
        higher: 'up',
        text: (c, name) => `${/Level/i.test(name) ? 'The number' : 'The change in the number'} of people with ${/Full-Time/i.test(name) ? 'full-time ' : /Part-Time/i.test(name) ? 'part-time ' : ''}jobs in ${c.region}. More jobs mean more people earning and spending - a sign of a strong economy.`
    },
    {
        test: /Participation Rate/i,
        higher: 'up',
        text: c => `The share of working-age people in ${c.region} who are either working or looking for work. A rising rate means more people joining the job market - usually read as a sign of confidence.`
    },
    {
        test: /Jobs to Applicants/i,
        higher: 'up',
        text: () => 'The number of job openings per job seeker in Japan. Above 1 means more jobs than applicants - a tighter job market that can push wages up.'
    },
    {
        test: /Average Weekly Hours/i,
        higher: 'up',
        text: () => 'The average number of hours worked each week by US employees. Longer hours mean firms need more labour - often a step before they hire.'
    },
    {
        test: /Employment Trends Index/i,
        higher: 'up',
        text: () => 'The Conference Board\'s index combining eight job-market indicators, designed to show where US employment is heading in the coming months.'
    },
    {
        test: /Job Advertisements/i,
        higher: 'up',
        text: () => 'The monthly change in job ads placed online and in newspapers in Australia (ANZ) - more ads point to stronger hiring ahead.'
    },
    {
        test: /Migration/i,
        higher: 'up',
        text: () => 'The net number of people moving to New Zealand long-term (arrivals minus departures). More migrants add to demand for housing, goods and services.'
    },
    {
        test: /Visitor Arrivals/i,
        higher: 'up',
        text: () => 'The number of short-term overseas visitors arriving in New Zealand. Tourism is one of its biggest export earners.'
    },

    // ---- Growth & activity ---------------------------------------------------------
    // (surveys whose names also contain "Manufacturing Production", "New
    // Orders"... come first, so they aren't mistaken for the official data)
    {
        test: /ISM .*(Employment|New Orders|Prices Paid|Business Activity)/i,
        higher: 'up',
        text: (c, name) => {
            const part = /Employment/i.test(name) ? 'hiring' : /New Orders/i.test(name) ? 'new orders - a hint of future output'
                : /Prices/i.test(name) ? 'prices paid for inputs - an early inflation signal' : 'business activity';
            return `Part of the ISM ${/Non-Manufacturing/i.test(name) ? 'services' : 'manufacturing'} survey of US purchasing managers: ${part}. Above 50 means it's rising.`;
        }
    },
    {
        test: /Philadelphia Fed|Empire State|Richmond Fed|Dallas Fed|Kansas City Fed|MNI Chicago/i,
        higher: 'up',
        text: (c, name) => {
            const district = /Philadelphia/i.test(name) ? 'Philadelphia' : /Empire/i.test(name) ? 'New York' : /Richmond/i.test(name) ? 'Richmond'
                : /Dallas/i.test(name) ? 'Dallas (Texas)' : /Kansas/i.test(name) ? 'Kansas City' : 'Chicago';
            const who = /Services/i.test(name) ? 'service businesses' : /MNI Chicago/i.test(name) ? 'businesses' : 'manufacturers';
            const scale = /MNI Chicago/i.test(name) ? 'Above 50 means business is growing' : 'Above zero means more firms report improvement than decline';
            return `A monthly survey of ${who} in the ${district} region${/Prices/i.test(name) ? ' on the prices they pay - a hint of inflation' : ''}. ${scale}. Regional surveys come out before the national ISM, so they're watched as an early hint.`;
        }
    },
    {
        test: /Current Account/i,
        higher: 'up',
        text: c => `The broadest measure of ${c.regionPos} dealings with the rest of the world - trade in goods and services plus investment income and transfers. A surplus means more money coming in than going out.`
    },
    {
        test: /NIESR/i,
        higher: 'up',
        text: () => 'The National Institute of Economic and Social Research\'s monthly estimate of UK growth over the last three months - an early read ahead of the official GDP figures.'
    },
    {
        test: /Net Exports Contribution|Private Consumption|Final Consumption Expenditure|Gross Fixed Capital Formation|Business Investment|Non-Residential Investment|GDP Expenditures/i,
        higher: 'up',
        text: (c, name) => {
            const part = /Net Exports/i.test(name) ? 'how much trade (exports minus imports) added to or took away from growth'
                : /Consumption/i.test(name) ? 'spending by households (and, for final consumption, government)'
                    : /Expenditures/i.test(name) ? 'GDP measured by adding up all spending'
                        : 'investment by businesses in buildings, machinery and equipment';
            return `A part of ${c.regionPos} GDP report: ${part}. It shows what drove growth - though the headline GDP figure usually matters most.`;
        }
    },
    {
        test: /GDP/i,
        higher: 'up',
        text: c => `Gross Domestic Product - the total value of all goods and services produced in ${c.region}, and the broadest measure of how the economy is doing. Strong growth can keep interest rates higher; weak growth raises the chance of cuts.`
    },
    {
        test: /Industrial Production Forecast/i,
        higher: 'up',
        text: () => 'Japanese manufacturers\' own forecast of how much they\'ll produce over the next one or two months - a forward-looking part of the industrial production report.'
    },
    {
        test: /Industrial Production|Manufacturing Production/i,
        higher: 'up',
        text: (c, name) => `The change in output from ${c.regionPos} ${/Manufacturing/i.test(name) ? 'factories' : 'factories, mines and utilities'}. More production signals stronger demand and a healthier economy.`
    },
    {
        test: /Capacity Utilization/i,
        higher: 'up',
        text: c => `The share of ${c.regionPos} factory, mining and utility capacity that's in use. High utilization means the economy is running hot - a sign of strength that can also push up inflation.`
    },
    {
        test: /Index of Services|Tertiary Industry/i,
        higher: 'up',
        text: c => `The change in output of ${c.regionPos} services sector - shops, offices, transport, finance and more, the largest part of the economy.`
    },
    {
        test: /Profit/i,
        higher: 'up',
        text: (c, name) => `The change in profits earned by ${/Industrial/i.test(name) ? 'industrial companies' : 'companies'} in ${c.region}. Rising profits support investment, hiring and wages.`
    },
    {
        test: /Construction (Output|Spending|Work Done|Orders)|Building Capital Expenditure/i,
        higher: 'up',
        text: (c, name) => `The change in ${/Orders/i.test(name) ? 'new orders received by builders' : 'construction activity'} in ${c.region}. Building is sensitive to interest rates and quick to turn when the economy does.`
    },
    {
        test: /Machinery Orders|Machine Tool Orders|Capital Goods (Orders|Shipments)/i,
        higher: 'up',
        text: (c, name) => `${/Shipments/i.test(name) ? 'Shipments' : 'Orders'} of machinery and equipment in ${c.region} - a leading indicator of business investment${/Core/i.test(name) ? ' (the core figure leaves out volatile orders such as ships and power utilities)' : /Aircraft/i.test(name) ? ' (leaving out defence and aircraft, which swing wildly)' : ''}.`
    },
    {
        test: /Capital Expenditure|Capital Spending|Fixed Asset Investment/i,
        higher: 'up',
        text: c => `Spending by businesses in ${c.region} on buildings, plant and equipment. Rising investment shows confidence and lays the ground for future growth.`
    },
    {
        test: /Durable Goods/i,
        higher: 'up',
        text: (c, name) => `New orders placed with US factories for goods meant to last three years or more - from aircraft and cars to machinery${/Core/i.test(name) ? '. The core figure leaves out volatile transportation orders' : /Defense/i.test(name) ? '. This version leaves out defence orders' : ''}. More orders signal stronger demand and investment.`
    },
    {
        test: /Factory Orders|Manufacturing Sales|Wholesale (Sales|Trade)|Industrial Sales/i,
        higher: 'up',
        text: (c, name) => `The change in the value of ${/Orders/i.test(name) ? 'new orders placed with factories' : /Wholesale/i.test(name) ? 'sales by wholesalers' : 'sales by manufacturers'} in ${c.region} - a gauge of demand for goods.`
    },
    {
        test: /Inventories/i,
        higher: null,
        text: (c, name) => `The change in the value of goods held in stock by ${/Retail/i.test(name) ? 'retailers' : /Wholesale/i.test(name) ? 'wholesalers' : 'businesses'} in ${c.region}.`,
        effect: c => `Mixed signal: stock-building adds to GDP, but rising inventories can also mean sales are slowing - so ${c.cur} rarely reacts much.`
    },
    {
        test: /Leading (Economic )?Index|Coincident Index|National Activity Index|KOF/i,
        higher: 'up',
        text: (c, name) => {
            if (/National Activity/i.test(name)) return 'The Chicago Fed\'s weighted average of 85 US economic indicators. Zero means the economy is growing at its long-run trend; above zero, faster.';
            if (/KOF/i.test(name)) return 'The KOF Swiss Economic Institute\'s leading indicator, built from a wide set of survey and economic data to signal where the Swiss economy is heading. 100 is the long-run average.';
            return /Coincident/i.test(name)
                ? `A composite index that tracks the current state of ${c.regionPos} economy from several indicators that move with it.`
                : `A composite index of indicators that tend to turn before the economy does, designed to signal where ${c.regionPos} economy is heading in the coming months.`;
        }
    },

    // ---- Surveys of businesses ---------------------------------------------------
    {
        test: /ZEW/i,
        higher: 'up',
        text: (c, name) => `The ZEW institute's monthly survey of financial analysts on ${/Situation/i.test(name) ? 'current' : 'expected (six months ahead)'} economic conditions in ${c.region}. Above zero means optimists outnumber pessimists.`
    },
    {
        test: /Sentix/i,
        higher: 'up',
        text: () => 'A monthly survey of investors\' views on the euro-area economy, now and six months ahead - one of the earliest sentiment readings each month.'
    },
    {
        test: /\bIfo\b/i,
        higher: 'up',
        text: (c, name) => `The Ifo institute's monthly survey of around 9,000 German businesses on ${/Expectations/i.test(name) ? 'their expectations for the next six months' : /Current/i.test(name) ? 'their current situation' : 'the overall business climate (now and ahead)'}. Germany is the euro area's largest economy, so this moves the euro.`
    },
    {
        test: /Tankan/i,
        higher: 'up',
        text: (c, name) => {
            const who = `${/Large/i.test(name) ? 'large' : 'small'} ${/Non-Manufacturing/i.test(name) ? 'non-manufacturers' : /Manufacturing/i.test(name) ? 'manufacturers' : 'companies'}`;
            return /Capex/i.test(name)
                ? `The Bank of Japan's quarterly Tankan survey - how much ${who} plan to spend on investment this fiscal year.`
                : `The Bank of Japan's quarterly Tankan survey of ${who}: the share reporting good business conditions minus the share reporting poor ones${/Outlook/i.test(name) ? ', for the coming quarter' : ''}. A key gauge of Japanese business confidence.`;
        }
    },
    {
        test: /\bBSI\b/i,
        higher: 'up',
        text: () => 'Japan\'s Business Survey Index for large manufacturers - positive when more firms see conditions improving than worsening.'
    },
    {
        test: /Economy Watchers/i,
        higher: 'up',
        text: (c, name) => `A Japanese survey of people whose jobs show them the economy up close - taxi drivers, shop staff, restaurant workers - on ${/Future/i.test(name) ? 'the outlook' : 'current conditions'}. Above 50 signals improvement.`
    },
    {
        test: /NFIB/i,
        higher: 'up',
        text: () => 'The National Federation of Independent Business\'s monthly survey of US small-business owners on sales, hiring, investment and the outlook.'
    },
    {
        test: /\bNAB\b/i,
        higher: 'up',
        text: (c, name) => `National Australia Bank's survey of Australian businesses on ${/Conditions/i.test(name) ? 'current trading, profits and hiring' : 'their confidence about the months ahead'}.`
    },
    {
        test: /ANZ (Business Confidence|Activity Outlook)/i,
        higher: 'up',
        text: (c, name) => `ANZ's monthly survey of New Zealand businesses - the share expecting ${/Activity/i.test(name) ? 'their own activity' : 'general business conditions'} to improve over the next year, minus the share expecting it to worsen.`
    },
    {
        test: /Economic Sentiment Indicator|Industrial Confidence|Services Sentiment|Business Climate Indicator/i,
        higher: 'up',
        text: (c, name) => `The European Commission's monthly survey of ${/Industrial/i.test(name) ? 'manufacturers' : /Services/i.test(name) ? 'service companies' : /Business Climate/i.test(name) ? 'manufacturers (on production, orders and stocks)' : 'businesses and consumers'} in the euro area. Higher readings mean more optimism.`
    },
    {
        test: /Economic Expectations/i,
        higher: 'up',
        text: () => 'A monthly survey of financial analysts on the Swiss economic outlook six months ahead - above zero means optimists outnumber pessimists.'
    },
    {
        test: /Consumer (Confidence|Sentiment|Climate|Expectations)|Current Conditions|GfK/i,
        higher: 'up',
        text: (c, name) => {
            const source = /^CB\b/.test(name) ? 'The Conference Board\'s survey' : /Michigan/i.test(name) ? 'The University of Michigan\'s survey'
                : /GfK/i.test(name) ? 'GfK\'s survey' : /Westpac/i.test(name) ? 'Westpac\'s survey' : 'A survey';
            const part = /Expectations/i.test(name) ? ' - the part about the months ahead' : /Current Conditions/i.test(name) ? ' - the part about current conditions' : '';
            return `${source} of how confident consumers in ${c.region} feel about the economy, their finances and spending plans${part}. Confident consumers spend more, and consumer spending drives most of the economy.`;
        }
    },
    {
        test: /PMI|Ai Group|BusinessNZ/i,
        higher: 'up',
        text: (c, name) => {
            const sector = /Ivey/i.test(name) ? 'economy' : /Services|Non-Manufacturing/i.test(name) ? 'services sector' : /Construction/i.test(name) ? 'construction sector'
                : /Composite/i.test(name) ? 'private sector (manufacturing and services combined)' : /Industry/i.test(name) ? 'industry' : 'manufacturing sector';
            const by = /Caixin/i.test(name) ? ' (Caixin\'s survey, weighted toward smaller private firms)' : /Ivey/i.test(name) ? ' (Ivey Business School)'
                : /Ai Group/i.test(name) ? ' (Australian Industry Group)' : /ISM/i.test(name) ? ' (Institute for Supply Management)' : '';
            return `A survey-based index of ${c.regionPos} ${sector}${by}: purchasing managers report on output, new orders, hiring, delivery times and prices. Above 50 means the sector is growing, below 50 shrinking - and because it's one of the first readings each month, markets watch it closely.`;
        }
    },
    {
        test: /Business (Confidence|Climate|Conditions)/i,
        higher: 'up',
        text: c => `A survey of businesses in ${c.region} on current conditions and the outlook. Higher readings mean more optimism - and often more hiring and investment ahead.`
    },

    // ---- Consumers & credit ----------------------------------------------------------
    {
        test: /Card (Retail Sales|Spending)/i,
        higher: 'up',
        text: () => 'The change in spending on debit and credit cards in New Zealand - a timely read on how much consumers are spending.'
    },
    {
        test: /Retail (Sales|Control)|Large Retailer/i,
        higher: 'up',
        text: (c, name) => {
            const extra = /Control/i.test(name) ? ' - the "control group" used to calculate GDP, leaving out autos, fuel, building materials and food services'
                : /excl/i.test(name) ? ' - leaving out cars and fuel, whose prices swing'
                    : /Core/i.test(name) ? ' - leaving out volatile items such as cars (and, in some countries, fuel)' : '';
            return `The change in the value of sales at retailers in ${c.region}${extra}. Consumer spending drives most of the economy.`;
        }
    },
    {
        test: /Household Spending/i,
        higher: 'up',
        text: () => 'The change in spending by Japanese households, from the government\'s family income and expenditure survey.'
    },
    {
        test: /Personal Spending|Real PCE|Consumer Spending/i,
        higher: 'up',
        text: (c, name) => `The change in what consumers in ${c.region} spend on goods and services${/Real/i.test(name) ? ', adjusted for inflation' : ''}. Consumer spending is the biggest part of the economy.`
    },
    {
        test: /Personal Income/i,
        higher: 'up',
        text: () => 'The change in Americans\' income from wages, investments and government benefits. Rising income supports future spending.'
    },
    {
        test: /Car Registrations/i,
        higher: 'up',
        text: c => `The number of new cars registered in ${c.region} compared with a month or a year earlier - a read on big-ticket consumer spending.`
    },
    {
        test: /Consumer Credit|Lending|Mortgage|Housing Credit|Private Sector Credit|Loans|Loan Growth|Housing Equity/i,
        higher: 'up',
        text: (c, name) => {
            const what = /Mortgage Approvals/i.test(name) ? 'The number of new mortgages approved - a leading indicator for the housing market'
                : /Housing Equity/i.test(name) ? 'How much households borrowed against the value of their homes (beyond what they spent on housing) - money often used for spending'
                    : /Mortgage|Housing|Home/i.test(name) ? 'How much people borrowed for homes'
                    : /Consumer|Individuals/i.test(name) ? 'How much consumers borrowed (credit cards, car loans and other credit)'
                        : 'How much households and businesses borrowed';
            return `${what} in ${c.region}. More borrowing reflects confidence and supports spending and investment.`;
        }
    },
    {
        test: /Money Supply|Money Stock|Monetary Base/i,
        higher: 'up',
        text: c => `The change in the amount of money circulating in ${c.region}. Faster growth can point to more spending and, later, inflation - but it's usually a minor market mover.`
    },
    {
        test: /Reserves|Reserve Assets/i,
        higher: null,
        text: c => `The value of foreign currencies, gold and other reserve assets held by ${c.bank}.`,
        effect: c => `Big changes can reveal currency intervention (selling reserves to support the ${c.currencyName}, or buying to weaken it); usually a minor mover.`
    },

    // ---- Housing ---------------------------------------------------------------------
    {
        test: /Housing Starts/i,
        higher: 'up',
        text: (c, name) => `The number of new homes on which building started in ${c.region}${/Annualized|CMHC/i.test(name) || c.cur === 'USD' ? ' (as a yearly rate)' : ''}. Home building creates jobs and spending, and reacts quickly to interest rates.`
    },
    {
        test: /Building (Permits|Approvals|Consents)|House Approvals/i,
        higher: 'up',
        text: c => `The number of new building permits approved in ${c.region} - a leading indicator of construction activity in the months ahead.`
    },
    {
        test: /Home Sales/i,
        higher: 'up',
        text: (c, name) => (/Pending/i.test(name)
            ? 'US homes put under contract but not yet sold - a lead on existing home sales a month or two later.'
            : `Sales of ${/New/i.test(name) ? 'newly built' : 'previously owned'} homes in the United States. A strong housing market reflects confident consumers and supports spending.`)
    },
    {
        test: /NAHB/i,
        higher: 'up',
        text: () => 'The National Association of Home Builders\' monthly survey of US builder confidence. Above 50 means more builders see good conditions than poor.'
    },

    // ---- Trade & money flows -----------------------------------------------------------
    {
        test: /Trade Balance/i,
        higher: 'up',
        text: (c, name) => `The difference between the value of ${/Goods/i.test(name) ? 'goods' : 'goods and services'} ${c.region} exports and imports${/Non-EU/i.test(name) ? ' with countries outside the EU' : /\bEU\b/.test(name) ? ' with other EU countries' : ''}. A bigger surplus (or smaller deficit) than expected means stronger foreign demand for ${c.adj} products - and for the ${c.currencyName} to pay for them.`
    },
    {
        test: /Exports|Export Volume/i,
        higher: 'up',
        text: c => `The value of goods ${c.region} sold abroad. Rising exports mean more foreign money flowing in to buy the ${c.currencyName}.`
    },
    {
        test: /Imports|Import Volume/i,
        higher: null,
        text: c => `The value of goods ${c.region} bought from abroad.`,
        effect: c => `Mixed signal: strong imports show healthy demand at home, but they also send money out of the country - so the trade balance usually matters more for ${c.cur}.`
    },
    {
        test: /Terms of Trade/i,
        higher: 'up',
        text: () => 'The ratio of New Zealand\'s export prices to its import prices. A rise means each unit of exports buys more imports - more national income.'
    },
    {
        test: /Foreign Bond Investment|by Canadians|Non-Resident Debt/i,
        higher: null,
        text: c => `Cross-border investment flows in ${c.regionPos} bond or securities markets, reported by the authorities.`,
        effect: c => `Large flows into or out of the country can move the ${c.currencyName}, but the figures are noisy and rarely move the market.`
    },
    {
        test: /\bTIC\b|Foreign Securities Purchases|Foreign Investment in|Foreign Direct Investment/i,
        higher: 'up',
        text: c => `How much foreign investors put into ${c.regionPos} stocks, bonds or businesses, net of what they sold. More foreign buying means more demand for the ${c.currencyName}.`
    }
];

// What a higher-than-expected reading means for the currency: 'up', 'down',
// null (no consistent direction), or undefined if the event isn't recognised
function economicEventTopic(name) {
    const text = String(name || '');
    return ECONOMIC_EVENT_TOPICS.find(topic => topic.test.test(text)) || null;
}

function economicEventPolarity(name) {
    const topic = economicEventTopic(name);
    if (!topic) return undefined;
    return typeof topic.higher === 'function' ? topic.higher(name) : topic.higher;
}

// Notes on the period codes in event names ("m/m", "y/y", "n.s.a."...)
function economicEventPeriodNote(name) {
    const notes = [];
    if (/3m\/3m/i.test(name)) notes.push('3m/3m: the last three months compared with the three before');
    else {
        if (/\bm\/m\b/i.test(name)) notes.push('m/m: change from the previous month');
        if (/\bq\/q\b/i.test(name)) notes.push('q/q: change from the previous quarter');
        if (/\by\/y\b/i.test(name)) notes.push('y/y: change from the same period a year earlier');
    }
    if (/YTD/.test(name)) notes.push('YTD: year to date');
    if (/Annualized/i.test(name)) notes.push('annualized: scaled up to a yearly rate');
    if (/12-Months/i.test(name)) notes.push('12-months: total over the last twelve months');
    if (/n\.s\.a\./i.test(name)) notes.push('n.s.a.: not adjusted for seasonal patterns');
    else if (/\bs\.a\./i.test(name)) notes.push('s.a.: adjusted for seasonal patterns');
    // (codes stay lowercase, as they appear in the event names)
    return notes.length ? `${notes.join('; ')}.` : '';
}

// Everything the "?" panel says about an event: { summary, effect, polarity, periodNote, place }
function describeEconomicEvent(name, currency, country) {
    const place = eventPlace(String(name || ''), currency, country);
    const topic = economicEventTopic(name);
    const polarity = topic ? (typeof topic.higher === 'function' ? topic.higher(name) : topic.higher) : undefined;
    let effect;
    if (polarity === 'up') effect = `Higher than forecast is usually good for ${place.cur}; lower is usually bad.`;
    else if (polarity === 'down') effect = `Higher than forecast is usually bad for ${place.cur} - it signals weakness; lower is usually good.`;
    else if (topic && topic.effect) effect = topic.effect(place, name);
    else effect = `No description for this event yet - the app treats a higher-than-forecast reading as good for ${place.cur}.`;
    return {
        summary: topic ? topic.text(place, String(name || '')) : '',
        effect,
        polarity,
        periodNote: economicEventPeriodNote(String(name || '')),
        place
    };
}
