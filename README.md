# ⚽ BetPredictor

A high-performance, client-side web application that provides data-driven football predictions using live data from the ESPN API. 

**BetPredictor** analyzes historical form, Head-to-Head (H2H) records, and scoring rates across Europe's top 6 leagues to calculate probabilities for match outcomes, BTTS (Both Teams to Score), and Over 2.5 Goal markets.

---

## 🌟 Key Features

*   **Live Data Integration:** Fetches real-time fixtures from the ESPN Scoreboard API for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1, and Liga Portugal.
*   **Deep Historical Analysis:** Automatically fetches the last 5 weeks of match results and the last 2 seasons of H2H data to build a statistical profile for every fixture.
*   **Prediction Engine:** Uses a weighted probability model to calculate:
    *   **Win/Draw/Loss Probabilities**
    *   **BTTS (Both Teams to Score) Likelihood**
    *   **Over 2.5 Goals Probability**
    *   **Expected ROI (Return on Investment)** based on simulated market odds.
*   **Interactive UI:** Features a dynamic dashboard with Chart.js visualization, weekend selection, and filtering by league or confidence level.
*   **Smart Caching:** Uses `sessionStorage` to minimize API calls and ensure a fast, responsive user experience.

---

## 🛠️ Technical Breakdown

### 🧠 The Prediction Model
The app uses a hybrid analysis approach:
1.  **Form Analysis:** Evaluates the last 5 matches for each team, calculating `winRate`, `scoringRate`, and `avgGoalsScored`.
2.  **H2H weighting:** If 3 or more historical meetings exist, the model weights H2H results at 40% and recent form at 60%.
3.  **Confidence Scoring:** Bets are categorized as **Strong**, **Medium**, or **Weak** based on the calculated probability thresholds (Strong > 65%).

### 💻 Stack
- **Frontend:** HTML5, CSS3 (Modern Flexbox/Grid layout)
- **Logic:** Vanilla JavaScript (ES6+) using `Async/Await` and `Promise.allSettled` for parallel API fetching.
- **Charts:** [Chart.js](https://www.chartjs.org/) for the confidence distribution doughnut chart.
- **Data Source:** [ESPN Public API](https://site.api.espn.com/apis/site/v2/sports/soccer).

---
## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 📧 Contact

**marovski** - [cardozo27cv@gmail.com](mailto:cardozo27cv@gmail.com)  
Project Link: [https://github.com/marovski/betpredictor](https://github.com/marovski/betpredictor)