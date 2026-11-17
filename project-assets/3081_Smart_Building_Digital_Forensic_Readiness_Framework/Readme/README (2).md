# Smart Building Digital Forensic Readiness Framework

**Team number:** 3081

**Team members:**

| Name | Roll No. |
|---|---|
| Savani Kulkarni | 25070521029 |
| Anvita Kulkarni | 25070521043 |
| Keyuri Buddhe | 25070521047 |

**Course / Institute:** `<B.Tech CSE, Symbiosis Institute of Technology, Nagpur>`
**Submission date:** 10 November 2026

---

## 1. Project overview

The project builds a digital forensic readiness framework for smart buildings. It has three linked parts:

1. **Detection:** a machine-learning model flags attack traffic in IoT network data (IoT-23 dataset).
2. **Tamper-evident evidence:** detections are stored in a hash-chained, signed log.
3. **Forensic readiness:** a quantitative score estimates how well a building could reconstruct an attack.

**What this ZIP contains:** the source code for the **detection part** (training and rigorous evaluation of the attack detector on IoT-23), in two Google Colab notebooks. The other parts (hash-chained log, evidence integrity, readiness simulation and dashboards) are not included in this ZIP.

**Objectives of the included code**

- Train a neural-network detector that separates benign IoT traffic from malicious traffic.
- Measure honestly how well it works on network captures it has never seen.

---

## 2. Contents of this ZIP

```
Team3081_SmartBuildingForensics/
├── README.md
├── SourceCode/
│   ├── ML_Model_2.ipynb
│   ├── ML_model3.ipynb
│   
├── Dataset/            (small sample, if included; otherwise the dataset is downloaded by the notebook)
└── Poster/
    └── poster.pdf
```

| File | Purpose |
|---|---|
| `SourceCode/ML_Model_2.ipynb` | Step 1: downloads IoT-23, reads the Zeek flow logs, splits the data by capture scenario, trains a small neural network (MLP) attack detector, prints precision, recall, F1, PR-AUC and a confusion breakdown, and saves the model and preprocessing recipe. |
| `SourceCode/ML_model3.ipynb` | Step 1c: uploads and runs the rigorous evaluation script (nested leave-one-capture-out evaluation of four models). |
| `SourceCode/iot23_step1c_rigorous_eval.py` | Evaluation script that `ML_model3.ipynb` uploads and runs. |
| `Poster/poster.pdf` | Project poster: objectives, methodology, key features and outcomes. |

---

## 3. Tools, technologies and software

| Item | Details |
|---|---|
| Platform | Google Colab (free CPU runtime) with Google Drive |
| Language | Python 3 (Colab default; run `!python --version` in a cell to see the exact version) |
| Libraries | PyTorch, pandas, NumPy, scikit-learn, SciPy, Matplotlib |
| Dataset | IoT-23, small release (Zeek `conn.log.labeled` files) |

All libraries are pre-installed on Google Colab, so nothing needs to be installed.

---

## 4. Dataset

- **Name:** IoT-23, small release (`iot_23_datasets_small.tar.gz`), 23 captures.
- **Source:** https://mcfp.felk.cvut.cz/publicDatasets/IoT-23-Dataset/
- **Why it is not in the ZIP:** the full dataset is very large. The notebook downloads it. Any sample in `Dataset/` is only for a quick look.
- **Download and extract (run in a Colab cell):**

```bash
!wget -c https://mcfp.felk.cvut.cz/publicDatasets/IoT-23-Dataset/iot_23_datasets_small.tar.gz
!mkdir -p /content/iot23 && tar -xzf iot_23_datasets_small.tar.gz -C /content/iot23
```

- **Features used:** duration, original and response bytes and packets, missed bytes, history length, protocol, service and connection state. Destination port is used in the base set only. IP addresses, timestamps and flow IDs are not used.
- **Sampling:** up to 40,000 flows per class per capture. Identical flow patterns inside a capture are collapsed (886,853 sampled flows became 153,180 distinct patterns); duplicate counts are kept as weights.
- **Labels:** `Benign` versus everything else.

---

## 5. How to run (step by step)

### Notebook 1: `ML_Model_2.ipynb` (run this first)

1. Open https://colab.research.google.com and sign in with a Google account.
2. Click **File → Upload notebook** and choose `SourceCode/ML_Model_2.ipynb`.
3. Click **Runtime → Run all**. Allow access to Google Drive if Colab asks. Outputs are saved to your own Drive in `MyDrive/PBL-Smart Building Digital Forensics/iot23_outputs/`.
4. The notebook downloads and extracts IoT-23 (this takes a few minutes), trains the model and prints the results.
5. A quick trial uses `MAX_CHUNKS_PER_FILE = 4`. For the full run, set `MAX_CHUNKS_PER_FILE = None` before running.

### Notebook 2: `ML_model3.ipynb` (rigorous evaluation)

1. In the same Colab session, after `ML_Model_2.ipynb` has finished (so the dataset is extracted), click **File → Upload notebook** and choose `SourceCode/ML_model3.ipynb`.
2. Run the first cell. When the file chooser appears, select `SourceCode/iot23_step1c_rigorous_eval.py`.
3. Run the next cell. The evaluation takes about 10 minutes.
4. The results (per-capture metrics, confidence intervals and learning curves) are printed and saved to the Drive output folder.

If the Colab runtime resets, `/content` is wiped. Upload the notebook again and re-run; files saved on Drive are not lost.

---

## 6. What to expect

| Notebook | Expected output |
|---|---|
| `ML_Model_2.ipynb` | Training and test accuracy, precision, recall, F1, PR-AUC and a confusion breakdown per scenario and attack type; the saved model and preprocessing files. |
| `ML_model3.ipynb` | A table comparing four models (MLP, logistic regression, random forest, gradient boosting) across 10 captures, with 95% confidence intervals. |

---

## 7. Method and results

### 7.1 Step 1: first training runs

- A quick trial (`MAX_CHUNKS_PER_FILE = 4`) gave 92% test accuracy and 97% recall, but almost all test attacks came from one easy capture (8-1). Test accuracy fell from 93% (epoch 7) to 62% (epoch 10) while training accuracy rose to 94%, which shows over-fitting.
- Five random scenario splits gave malicious recall of 0.271, 0.994, 0.833, 0.018 and 0.000. With only 23 captures, results depend heavily on which captures are held out for testing. This is why leave-one-capture-out evaluation was used.

### 7.2 Step 1c: rigorous evaluation

- **Protocol:** nested leave-one-capture-out over 10 captures that contain both classes (at least 50 distinct patterns each). Inside each fold, 3 validation captures set early stopping and the alert threshold (5% false-alarm budget, strict `>` comparison so ties are not flagged). 3 seeds. Each capture is one data point; bootstrap 95% confidence intervals over captures.
- **Results (mean over 10 captures):**

| Model | Recall | 95% CI | False-alarm rate | Precision | MCC | PR-AUC | Recall at 5% FPR |
|---|---|---|---|---|---|---|---|
| MLP (128-64) | 0.437 | 0.310–0.583 | 0.124 | 0.788 | 0.309 | 0.811 | 0.757 |
| Logistic regression | 0.424 | 0.264–0.605 | 0.100 | 0.720 | 0.314 | 0.798 | 0.691 |
| Random forest | 0.185 | 0.053–0.341 | 0.063 | 0.735 | 0.126 | 0.856 | 0.702 |
| Gradient boosting | 0.341 | 0.131–0.580 | 0.030 | 0.722 | 0.307 | 0.844 | 0.632 |

- **Findings:**
  - No model was clearly better (paired Wilcoxon tests not significant).
  - Learning curves showed a gap between training and validation scores from epoch 1, so the problem is shift between captures, not model size.
  - Ranking quality (PR-AUC) was stable, but recall at the chosen threshold swung between 0 and 1 across seeds: the alert threshold is unstable.
  - Capture 35-1 was flagged almost entirely (false-alarm rate 0.997); capture 7-1 was hardly detected at the threshold (recall 0.22); captures 8-1 and 48-1 were handled well.

---

## 8. Limitations

- The detector performs unevenly across captures, and the alert threshold does not transfer between them.
- IoT-23 is lab-generated malware traffic, and duplicate flows were collapsed for training.
- Results come from 10 captures, so confidence intervals are wide.

---

## 9. Poster

The project poster is in `Poster/poster.pdf`. It summarises the objectives, methodology, key features and outcomes of the whole project.
