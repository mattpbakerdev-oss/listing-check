# Where the sample data comes from

The listings in `listings.csv` are generated, not scraped. They are anchored to public figures so the price benchmark gives believable answers. Checked 14 October 2026.

## Rent per sqm by area (`areas.csv`)

No agency publishes condo rent per sqm by sub-area. Each area's typical figure is a blend of:

- Live listing medians from FazWaz sub-district rental pages (first page of listings, roughly 20 to 25 per area, serviced apartments trimmed out).
- Superagent's 2026 rent-per-sqm and 1-bed price articles (agent-reported bands by corridor).
- Good Yield Life's May 2026 zone table from 2,880 listings.

Low and high are roughly the 20th to 80th percentile of what was seen. Ekkamai is marked `interpolated` because it only had three building-level data points.

Sanity checks: FazWaz citywide median about 629 THB/sqm (Sep 2026); CBRE Q2 2026 Grade A downtown apartments 581 THB/sqm.

- Superagent, rent per sqm by area 2026: https://www.superagent.co/en/blog/bangkok-condo-price-per-sqm-in-2026-real-numbers-by-area
- Superagent, 1-bed prices across Bangkok 2026: https://www.superagent.co/en/blog/1-bedroom-condo-prices-across-bangkok-in-2026-where-your-money-goes
- Superagent, rental price review by district 2026: https://www.superagent.co/en/blog/bangkok-condo-rental-price-review-by-district-2026-latest-updates
- Good Yield Life, Bangkok rent by zone May 2026: https://goodyieldprop.com/articles/bangkok-rent-by-zone-2026
- FazWaz sub-district pages, e.g. Khlong Tan Nuea: https://www.fazwaz.com/condo-for-rent/thailand/bangkok/watthana/khlong-tan-nuea (and the matching pages for Khlong Tan, Khlong Toei Nuea, Phra Khanong Nuea, Bang Chak, Sam Sen Nai, Sathon, Si Lom, Ratchathewi, Huai Khwang, Bang Na, Chatuchak, Lat Phrao)
- Bamboo Routes, Bangkok rents (citywide median): https://bambooroutes.com/blogs/news/bangkok-rents
- CBRE Thailand, Bangkok Overall Figures Q2 2026: https://mktgdocs.cbre.com/2299/572f56cb-8f5b-4103-b239-5257a6109fa2-1936958774/Bangkok-Overall-Figures-Q2-202.pdf

## Buildings (`buildings.csv`)

62 real condominiums, confirmed on FazWaz or PropertyScout listing pages. Nearest station, completion year and tier are as listed there or judged from rent level and developer. Walk minutes are straight-line distance divided by 80 m/min, so treat them as rough.

## How the generator works (`generate_listings.py`)

- Picks a building, draws a unit type and size.
- Price = area typical per sqm, times a tier multiplier (luxury 1.22, mid 1.02, budget 0.88), times an age discount, times a small-unit premium, plus noise, clamped to the area band.
- 40% of listings get one or two deliberate flaws (missing floor, few photos, short description, caps title, overpriced, typo in price, and so on). The `flaws` column is the ground truth for measuring the checker. It would be empty on real data.
- Thai descriptions are simple templates, enough to exercise the bilingual rewrite, not natural copy.
