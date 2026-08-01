import { Pool } from 'pg';
import { readDb, writeDb } from '../server/db.js';

const rawData = `
MFSJ	Marine Lines	MH	MUM	WR	BCT
MCGB	Manchheri Goods Yard	OR	SNG	SER	CKP
FBD	Farrukhabad Junction	UP	FBD	NER	IZN
BTRI	Bitroi	UP	BDA	NER	IZN
CHIB	Chiah	JH	PGL	ECR	DHN
CH	Chandausi Junction	UP	SMB	NR	MB
MBWK	Marwar Bithri	RJ	PAL	NWR	JU
KLSK	Kalsi	UT	DDE	NR	UMB
KKBK	Kaki	AS	NGA	NFR	LMG
MGMT	Mcgermont	ML	SHL	NFR	LMG
AKKK	Akkur	TN	NAG	SR	MAS
PPI	Pipariya	MP	HNM	WCR	JBP
DIB	Dibai	UP	BUL	NR	MB
SKSS	Sukhpur	BR	SUP	ECR	SPJ
ABBS	Ambale	MH	PUNE	CR	PA
MLVM	Malavli	MH	PUNE	CR	PA
NELM	Neligonda	TS	MBNR	SCR	HYB
HPCV	Harchandpur	UP	RBL	NR	LKO
GIMB	Gandhidham Junction	GJ	KUT	WR	ADI
MEGN	Meghnagar	MP	JHA	WR	RTM
MTPK	Mathura Post Office	UP	MTJ	NCR	AGC
GUNA	Guna Junction	MP	GUN	WCR	BPL
SWSS	Shivsagar Road	BR	ROA	ECR	MGS
NNV	Nannilam	TN	TVR	SR	TPJ
JDWS	Jewar Road	UP	GBN	NCR	ALD
SRVA	Shirravde	MH	SAT	CR	PA
CRPD	Chandrapur Road	MH	CHA	CR	NGP
NAS	Nasik Road	MH	NAS	CR	BSL
VGSD	Vangaon	MH	PAL	WR	BCT
DKZ	Delhi Kishanganj	DL	CDL	NR	DLI
LAD	Lalgopalganj	UP	PRG	NR	LKO
MWSD	Morwani	MP	RTM	WR	RTM
SNLR	Sanaswadi	MH	PUNE	CR	PA
VSPV	Visakhapatnam Port	AP	VSK	ECoR	WAT
PBSB	Phusro Goods	JH	BOK	ECR	DHN
HVD	Halvad	GJ	MOR	WR	ADI
GPIM	Gopinathpur	WB	PUR	SER	ADRA
HPGN	Haripal	WB	HOO	ER	HWH
MSGM	Masagram Junction	WB	PUR	ER	HWH
SAMT	Salem Town	TN	SAL	SR	SA
PNHR	Panagarh	WB	PAS	ER	ASN
LKA	Lanka	AS	HJO	NFR	LMG
IGCS	Indargarh	RJ	BUN	WCR	KOTA
KSLK	Karsindhu	HR	JND	NR	DLI
BYX	Bhayani	GJ	AHM	WR	ADI
LCH	Lachhmangarh Sikar	RJ	SIK	NWR	JP
GRPB	Garhi Harsaru Junction	HR	GUG	NR	DLI
ANDI	Adarsh Nagar Delhi	DL	NDL	NR	DLI
BYR	Bhayandar	MH	PAL	WR	BCT
PRIL	Pileru	AP	CTT	SCR	GTL
NELK	Nellikuppam	TN	CUD	SR	TPJ
NLPD	Nallapadu Junction	AP	GNT	SCR	GNT
KI	Kiul Junction	BR	LKR	ECR	DNR
EOLD	Erode Goods Yard	TN	ERO	SR	SA
DPS	Dangoaposi	JH	WSB	SER	CKP
STCM	Srirampur	WB	HOO	ER	HWH
AMG	Alamnagar	UP	LKO	NR	LKO
ROU	Rourkela Junction	OR	SNG	SER	CKP
NLP	Akhalaspur	BR	ROA	ECR	MGS
NHSB	Nahava Sheva	MH	RIG	CR	BCT
BMPR	Badampahar	OR	MYB	SER	CKP
MRCJ	Mirchadhori	UP	SBR	ECR	DHN
BPKR	Bhapkar	MH	PUNE	CR	PA
JWP	Jwalapur	UT	HAR	NR	MB
JMTC	Jammu Tawi Cabin	JK	JAM	NR	FZR
UCLJ	Unchahar Junction	UP	RBL	NR	LKO
HPCA	Hope Cabin	WB	DAR	NFR	KIR
GXSG	Gujarat Station	GJ	AHM	WR	ADI
RVD	Raveshwar	GJ	AHM	WR	ADI
PDPB	Padampur	RJ	SGNR	NWR	BKN
CHH	Chauk	MH	RIG	CR	BB
SKP	Shankarpalli	TS	RR	SCR	SC
FOS	Fakiragram Junction	AS	KOK	NFR	APDJ
GME	Gomoh Junction	JH	DHN	ECR	DHN
BDO	Bahir Khanda	WB	HOO	ER	HWH
ANR	Anara	WB	PUR	SER	ADRA
TTO	Tunturi	WB	PUR	SER	ADRA
GFCJ	Ganj Dudhwara	UP	KAS	NER	IZN
ADRA	Adra Junction	WB	PUR	SER	ADRA
JUDW	Jagadhri Workshop	HR	YAN	NR	UMB
SONU	Sonu	RJ	JSM	NWR	JU
TTLA	Titilagarh Junction	OR	BLG	ECoR	SBP
RRP	Roodrapur Depot	UT	USN	NER	IZN
MLJ	Mullanpur	PB	LUD	NR	FZR
BPAG	Bhimpur	BR	SUP	ECR	SPJ
OPSG	Orissa Port Siding	OR	PRD	ECoR	KUR
BBMN	Barabhum	WB	PUR	SER	ADRA
MRIK	Mirchar	OR	SNG	SER	CKP
BTE	Bharatpur Junction	RJ	BTP	WCR	KOTA
PGFC	Pagara Coal Cabin	MP	MOR	NCR	JHS
BXF	Barsuan	OR	SNG	SER	CKP
PSMM	Paschim Medinipur	WB	MID	SER	KGP
KGPW	Kharagpur Workshop	WB	MID	SER	KGP
IOTS	Indian Oil Siding	GJ	BRD	WR	BRCP
RUI	Rukni	WB	PUR	SER	ADRA
ICKR	Icchapur	WB	NORTH24	ER	SDAH
ICB	Ichchapuram	AP	SKL	ECoR	WAT
ARVY	Arvi	MH	WRD	CR	NGP
WML	Wankaner Model	GJ	MOR	WR	ADI
GWCB	Gwalior Cabin	MP	GWL	NCR	JHS
SNF	Sanatnagar	TS	HYD	SCR	SC
BQER	Bhagalpur East Cabin	BR	BGP	ER	MLDT
MAEL	Mael	JH	RAM	ECR	DHN
LGT	Langting	AS	NC	NFR	LMG
LAPR	Lalgopalganj	UP	PRG	NR	LKO
ZPL	Zangalapalle	AP	ATP	SCR	GTL
ANT	Anantapur	AP	ATP	SCR	GTL
BE	Bareilly Junction	UP	BEY	NR	MB
BICI	Barkani	MP	JBP	WCR	JBP
BOJ	Barabambo	JH	WSB	SER	CKP
CILI	Chilkahar	UP	BAL	NER	BSB
DGNG	Durgapur North	WB	PAS	ER	ASN
DRGM	Deoragram	AS	KAN	NFR	LMG
IOBD	IOC Siding Baroda	GJ	BRD	WR	BRCP
KEMA	Kaimari	MP	KAT	WCR	JBP
KOD	Koduru	AP	CTT	SCR	GTL
LDH	Ludhiana Junction	PB	LUD	NR	FZR
MBPC	Marwar Balotra	RJ	BAL	NWR	JU
MDIT	Mandi Dabwali	PB	BTI	NWR	BKN
NDD	Nidadavolu Junction	AP	WG	SCR	BZA
PLBR	Palani	TN	DGL	SR	MDU
RCLM	Raghunathpur	BR	BXR	ECR	DNR
REWA	Rewa	MP	REW	WCR	JBP
RUSG	Rupsa Junction	OR	BAL	SER	KGP
SADP	Saidapur	KA	YAD	SCR	GTL
SUW	Sukhisewaniyan	MP	BPL	WCR	BPL
TCLD	Tiruchirappalli Yard	TN	TPE	SR	TPJ
TKGD	Thakurtola	CG	RJN	SECR	R
TU	Tadi	AP	VSK	ECoR	WAT
WCSG	Wani Coal Siding	MH	YAT	CR	NGP
MSCA	Musafirkhana	UP	AME	NR	LKO
PBE	Pilibhit Junction	UP	PIL	NER	IZN
HD	Harda	MP	HAR	WCR	BPL
MCTM	Martyr Captain Tushar Mahajan	JK	UDH	NR	FZR
DRB	Debari	RJ	UDA	NWR	AII
ACCG	Achalpur Coal	MH	AMT	CR	NGP
SORI	Sorai	MP	VID	WCR	BPL
HPCG	Harchandpur Cabin	UP	RBL	NR	LKO
KBP	Khed Brahma	GJ	SK	WR	ADI
MZS	Murkeongselek	AS	DHE	NFR	TSK
BARJ	Bharatpur Yard	RJ	BTP	WCR	KOTA
YTPV	Yadgir Siding	KA	YAD	SCR	GTL
KPRK	Gopalpur	WB	MID	SER	KGP
LPH	Lotapahar	JH	WSB	SER	CKP
SANG	Sangrur	PB	SAN	NR	UMB
BPAJ	Bhirpur	UP	PRG	NCR	ALD
CFVS	Chhatarpur	MP	CHT	NCR	JHS
PLMD	Palam	DL	SWD	NR	DLI
BRMS	Baramasia	JH	DHN	ECR	DHN
WL	Warangal	TS	WL	SCR	SC
LGH	Lalgarh Junction	RJ	BKN	NWR	BKN
KXN	Kanyan	WB	PUR	SER	ADRA
GGN	Gurgaon	HR	GUG	NR	DLI
NOMD	Noamundi	JH	WSB	SER	CKP
BVM	Bayyavaram	AP	VSK	ECoR	WAT
GGPP	Gangadharpark Cabin	WB	PAS	ER	ASN
GOTN	Gotan	RJ	NAG	NWR	JU
RCPB	Ramchandraapur Cabin	WB	PUR	SER	ADRA
KIJ	Kistamsettipalli	TS	MBNR	SCR	HYB
GUMI	Gummandidala	TS	MED	SCR	SC
IOMB	IOC Siding Bareilly	UP	BEY	NR	MB
PCSK	Pachora Cabin	MH	JAL	CR	BSL
BPGK	Bhupatwala Goods	UT	HAR	NR	MB
BGWR	Bagwanola	UP	FBD	NER	IZN
NRT	Narasaraopet	AP	GNT	SCR	GNT
RNG	Raniganj	WB	PAS	ER	ASN
NLDA	Nalgonda	TS	NLG	SCR	GNT
RGZ	Rayagada	OR	RAY	ECoR	WAT
PSJ	Patas	MH	PUNE	CR	PA
IOGS	Indian Oil Siding	WB	PUR	ER	HWH
CSSL	Chhatrapur Siding	OR	GAN	ECoR	KUR
GMH	Gamharia Junction	JH	SER	SER	CKP
JAT	Jammu Tawi	JK	JAM	NR	FZR
NFPG	Narayanpur Anant	BR	MUZ	ECR	SEE
BKSN	Bhagwanpur Desua	BR	SAM	ECR	SPJ
NDKD	Nudurupadu	AP	GNT	SCR	GNT
NCTP	North Chennai Thermal	TN	CHN	SR	MAS
TIS	Tatisilwai	JH	RAN	SER	RNC
KAF	Kalimgarh	HR	JND	NR	DLI
BPCR	Bhapkar	MH	PUNE	CR	PA
BCME	Bichia	MP	MAND	SECR	NGP
KEQ	Kausani	UT	BAG	NER	IZN
MPCT	Mathura Post Yard	UP	MTJ	NCR	AGC
MPCJ	Mathura Yard Cabin	UP	MTJ	NCR	AGC
MNGT	Managatta	KA	KOL	SWR	SBC
BPMG	Badampahar Goods	OR	MYB	SER	CKP
PMAK	Paman	UP	KAN	NCR	CNB
MBPJ	Marwar Balotra Yard	RJ	BAL	NWR	JU
WCMB	Western Coalfields Siding	MH	CHA	CR	NGP
MBPB	Marwar Balotra Cabin	RJ	BAL	NWR	JU
LUN	Luni Junction	RJ	JU	NWR	JU
LPGS	Lalgopalganj Siding	UP	PRG	NR	LKO
GSPR	Gospur	AP	KUR	SCR	GTL
WH	Walshapuram	TN	CUD	SR	TPJ
PBWB	Phusro West Siding	JH	BOK	ECR	DHN
STA	Satna Junction	MP	SAT	WCR	JBP
DMF	Dhamora	UP	RAM	NR	MB
DHWS	Dhawla Siding	RJ	JSM	NWR	JU
PBCB	Phusro Cabin	JH	BOK	ECR	DHN
DDCE	Dundi Coal Cabin	MP	KAT	WCR	JBP
SOG	Suratgarh Junction	RJ	SGNR	NWR	BKN
BH	Bharuch Junction	GJ	BHA	WR	BRCP
OGL	Ongole	AP	PRA	SCR	BZA
APLP	Appikatla	AP	GNT	SCR	BZA
SAIT	Saidapur	KA	YAD	SCR	GTL
RZN	Rajhura	JH	PAL	ECR	DHN
NWR	Nawagarh	CG	BLA	SECR	BSP
EMIJ	Elamanchili Yard	AP	VSK	ECoR	WAT
ET	Itarsi Junction	MP	HNM	WCR	BPL
FBWS	Farrukhabad Siding	UP	FBD	NER	IZN
FCSS	Firozpur Yard	PB	FZR	NR	FZR
FDK	Faridkot	PB	FDK	NR	FZR
FKA	Fazilka Junction	PB	FZR	NR	FZR
GNN	Gangani	WB	MID	SER	KGP
CSPS	Chandrapur Siding	MH	CHA	CR	NGP
GRBL	Garhi Harsaru Siding	HR	GUG	NR	DLI
GWD	Gadwal Junction	TS	MBNR	SCR	HYB
HLSR	Holalkere	KA	CHT	SWR	MYS
HMG	Hamirgarh	RJ	BHL	NWR	AII
HMH	Hanumangarh Junction	RJ	HMH	NWR	BKN
COIB	Coimbatore North	TN	CBE	SR	SA
CLE	Chhatral	GJ	GHD	WR	ADI
HPKB	Haripal Cabin	WB	HOO	ER	HWH
CHNR	Chhanera	MP	KHA	WCR	BPL
HYA	Hathuran	GJ	SUR	WR	BRCP
CHE	Srikakulam Road	AP	SKL	ECoR	WAT
IDG	Indargarh	RJ	BUN	WCR	KOTA
IFFB	IFFCO Siding Bareilly	UP	BEY	NR	MB
CFCS	Chhatarpur Siding	MP	CHT	NCR	JHS
IGFC	Indargarh Cabin	RJ	BUN	WCR	KOTA
IOBP	IOC Siding Baroda	GJ	BRD	WR	BRCP
IOCD	IOC Siding Delhi	DL	CDL	NR	DLI
IODT	IOC Siding Tinsukia	AS	TSK	NFR	TSK
IOGM	IOC Siding Gomoh	JH	DHN	ECR	DHN
ION	Indore Junction Cabin	MP	IND	WR	RTM
IOPB	IOC Siding Punjab	PB	LUD	NR	FZR
JCL	Jadcherla	TS	MBNR	SCR	HYB
JID	Jharli	HR	JJR	NWR	RE
JKE	Jukehi	MP	KAT	WCR	JBP
JND	Junagadh Junction	GJ	JUN	WR	BVP
CBK	Chachaura Binaganj	MP	GUN	WCR	BPL
WADI	Wadi Junction	KA	KAL	SCR	SUR
KMX	Khem Karan	PB	TAR	NR	FZR
KRKP	Koraput Junction	OR	KOR	ECoR	WAT
KSNG	Kesinga	OR	KLA	ECoR	SBP
KTPG	Karatampi	TN	TPJ	SR	TPJ
KZJ	Kazipet Junction	TS	WL	SCR	SC
BSPR	Bishrampur	CG	SURJ	SECR	R
LPGK	Lalgopalganj Cabin	UP	PRG	NR	LKO
LTK	Lathikata	OR	SNG	SER	CKP
MALB	Mallial	TS	KAR	SCR	SC
BRGT	Bheraghat	MP	JBP	WCR	JBP
BPRG	Bazpur	UT	USN	NER	IZN
BPNA	Bhapan	WB	PUR	ER	HWH
MHPL	Mahipal Road	WB	MUR	ER	HWH
MNSM	Mansurpur	UP	MUZ	NR	DLI
NFLB	NFL Siding Bhatinda	PB	BTI	NR	UMB
BIDR	Bidar	KA	BID	SCR	SC
BHTA	Bhatiya	GJ	DEV	WR	RJT
NMFS	Nanded Freight Siding	MH	NED	SCR	NED
NMZ	New Mal Junction	WB	JAP	NFR	APDJ
BHD	Badod	MP	SHJ	WR	RTM
NSZ	Nishatpura	MP	BPL	WCR	BPL
OND	Ornt	RJ	BKN	NWR	BKN
OPL	Uppal	TS	KAZ	SCR	SC
PAX	Pandraali	MH	PUNE	CR	PA
PHR	Phillaur Junction	PB	LUD	NR	FZR
PIS	Pisasangan	RJ	AII	NWR	AII
PKNB	Pokaran Cabin	RJ	JSM	NWR	JU
PMPE	Paman Post	UP	KAN	NCR	CNB
BCPL	Indian Petrochem Siding	GJ	BRD	WR	BRCP
POSN	Panipat Siding	HR	PNP	NR	DLI
RKSH	Rishikesh	UT	DDE	NR	MB
RKSI	Roorkee Siding	UT	HAR	NR	MB
AULS	Agori Khas Siding	UP	SON	ECR	DHN
RTPM	Ratlam Post Yard	MP	RTM	WR	RTM
ATUV	Attabira Yard	OR	SBP	ECoR	SBP
RVSJ	Raveshwar Junction	GJ	AHM	WR	ADI
RWGR	Rawatsar	RJ	HMH	NWR	BKN
ASKN	Ashok Nagar	MP	ASKN	WCR	BPL
SBNR	Shadnagar	TS	MBNR	SCR	HYB
SBTG	Sabarmati Goods	GJ	AHM	WR	ADI
SEH	Sehore	MP	SEH	WCR	BPL
ASGS	Asansol Goods	WB	PAS	ER	ASN
SLO	Samalkot Junction	AP	EG	SCR	BZA
SMP	Shambhupura	RJ	CHT	WCR	KOTA
SPTR	Silapathar	AS	DHE	NFR	TSK
SSPD	Sadashivpet Road	TS	MED	SCR	SC
SVMS	Shivamogga Town	KA	SHI	SWR	MYS
ADTP	Adityapur	JH	SER	SER	CKP
SZN	Shambhu	PB	PAT	NR	UMB
TBN	Timarni	MP	HAR	WCR	BPL
TPY	Tadpatri	AP	ATP	SCR	GTL
TRR	Taraori	HR	KAN	NR	DLI
UTCT	UltraTech Cement Siding	MP	SAT	WCR	JBP
VAA	Bhaga Junction	JH	DHN	ECR	DHN
VG	Viramgam Junction	GJ	AHM	WR	ADI
DKNS	Devkanchan	WB	MID	SER	KGP
DMC	Dhemaji	AS	DHE	NFR	TSK
DHD	Dahod	MP	JHA	WR	RTM
VTJ	Visakhapatnam Town	AP	VSK	ECoR	WAT
DSLD	Deswal	RJ	PAL	NWR	AII
DTJ	Detroj	GJ	AHM	WR	ADI
DWX	Dewas	MP	DEW	WR	RTM
DGU	Digaru	AS	KAN	NFR	LMG
MTM	Machilipatnam	AP	KRI	SCR	BZA
BNDA	Banda Junction	UP	BAN	NCR	JHS
MUT	Meerut Cantt	UP	MEE	NR	DLI
MUTG	Meerut Cantt Goods	UP	MEE	NR	DLI
BN	Barnala	PB	SNG	NR	UMB
MZCY	Mirza Cheka	WB	MUR	ER	HWH
CBSA	Chaibasa	JH	WSB	SER	CKP
BLSG	Bilaspur Goods	CG	BLA	SECR	BSP
NBA	Nabadwip Dham	WB	NAD	ER	HWH
JKCM	JK Cement Siding	RJ	CHT	WCR	KOTA
WGCR	Wani Goods Cabin	MH	YAT	CR	NGP
JKCG	JK Cement Goods	RJ	CHT	WCR	KOTA
NDSB	Nadiad Siding	GJ	KED	WR	ADI
BL	Valsad	GJ	VAL	WR	BCT
CBU	Chhabra Gugor	MP	GUN	WCR	BPL
DHI	Dhule	MH	DHU	CR	BSL
NFLG	NFL Goods Bhatinda	PB	BTI	NR	UMB
CCIB	CCI Siding Bokaro	JH	BOK	ECR	DHN
NGCM	Nagda Cabin	MP	UJJ	WR	RTM
FCMA	Firozpur Cabin A	PB	FZR	NR	FZR
VZM	Vizianagaram Junction	AP	VZM	ECoR	WAT
TFMB	Tatanagar Goods	JH	SER	SER	CKP
BHNG	Bhongir	TS	NLG	SCR	SC
NLY	Neyveli	TN	CUD	SR	TPJ
FCIZ	FCI Siding Zira	PB	FZR	NR	FZR
NMGS	New Mal Goods	WB	JAP	NFR	APDJ
ZB	Zaheerabad	TS	MED	SCR	SC
NNO	Nangal Dam	PB	ROP	NR	UMB
TPNR	Transport Nagar	UP	LKO	NR	LKO
IISM	IISCO Siding Burnpur	WB	PAS	ER	ASN
IFFP	IFFCO Siding Phulpur	UP	PRG	NCR	ALD
DLJ	Dhola Junction	GJ	BVP	WR	BVP
NU	Narsinghpur	MP	NAR	WCR	JBP
NVS	Navsari	GJ	NAV	WR	BCT
IFAB	IFFCO Siding Amla	MP	BET	CR	NGP
HSX	Hoshiarpur	PB	HOS	NR	FZR
TQA	Takia	UP	UNN	NR	LKO
DLO	Dalgaon	WB	JAP	NFR	APDJ
HPOB	Haripal Outer	WB	HOO	ER	HWH
PAW	Pandbeswar	WB	PAS	ER	ASN
TSLE	Tatanagar Siding	JH	SER	SER	CKP
CLX	Chirala	AP	PRA	SCR	BZA
CPE	Chandrapur West	MH	CHA	CR	NGP
CPN	Champaner Road	GJ	PAN	WR	BRCP
GVSG	Gujarat Siding	GJ	AHM	WR	ADI
CPP	Chipurupalle	AP	VZM	ECoR	WAT
BGN	Borraguhalu	AP	VSK	ECoR	WAT
PEP	Phephna Junction	UP	BAL	NER	BSB
BCSW	Indian Petro Siding West	GJ	BRD	WR	BRCP
PGFV	Pagara Yard	MP	MOR	NCR	JHS
TSPD	Tatanagar Yard	JH	SER	SER	CKP
ADH	Andheri	MH	MUM	WR	BCT
ADF	Adina	WB	MAL	ER	MLDT
PKYN	Palwal Siding	HR	PAL	NR	DLI
GUA	Gua	JH	WSB	SER	CKP
GSFS	Gujarat Fertilizer Siding	GJ	BRD	WR	BRCP
GSFM	Gujarat Fertilizer Yard	GJ	BRD	WR	BRCP
PMHD	Paman Goods	UP	KAN	NCR	CNB
ZN	Jangaon	TS	WAR	SCR	SC
PMRB	Paman Cabin	UP	KAN	NCR	CNB
TUA	Tirunelveli Cabin	TN	TIR	SR	MDU
PNMB	Panambur	KA	DAK	SWR	MAQ
PNOB	Panambur Outer	KA	DAK	SWR	MAQ
TULI	Tundla Siding	UP	FIRO	NCR	ALD
CSAS	Chhatrapur South	OR	GAN	ECoR	KUR
PQN	Parque Town	WB	HWH	ER	HWH
GQL	Gaura	UP	PRG	NR	LKO
GK	Ghorpuri	MH	PUNE	CR	PA
BAHL	Banasthali Niwai	RJ	TON	NWR	JP
PSMR	Paschim Medinipur Siding	WB	MID	SER	KGP
PUL	Rampurhat Outer	WB	BIR	ER	HWH
RASP	Rasoolpur	UP	UNN	NR	LKO
WHG	Walshapuram Goods	TN	CUD	SR	TPJ
DBTK	Dabtara	UP	BDA	NER	IZN
RE	Rewari Junction	HR	REW	NWR	RE
WKR	Wankaner Junction	GJ	MOR	WR	ADI
GGR	Gangarampur	WB	DDA	NFR	KIR
RINN	Ranebennur Siding	KA	HAV	SWR	UBL
RK	Roorkee	UT	HAR	NR	MB
ACPC	Achalpur Yard	MH	AMT	CR	NGP
UGSU	Uhar Siding	MP	SAT	WCR	JBP
RMJC	Ramcharan Siding	UP	SBR	ECR	DHN
DCSM	Durgapur Cabin	WB	PAS	ER	ASN
BAF	Bap	RJ	JU	NWR	JU
ULGJ	Uluberia Siding	WB	HOW	SER	KGP
USD	Usalapur	CG	BLA	SECR	BSP
RU	Renigunta Junction	AP	CTT	SCR	GTL
UTCH	UltraTech Siding Haridaspur	OR	JAJ	ECoR	KUR
GDYT	Gonda Yard	UP	GON	NER	GD
ASLS	Asansol Siding	WB	PAS	ER	ASN
UTCR	UltraTech Siding Rewa	MP	REW	WCR	JBP
ERM	Ernakulam South	KL	EKM	SR	TVC
GDRA	Godhra Junction	GJ	PAN	WR	BRCP
AAR	Adeshar	GJ	KUT	WR	ADI
SAIK	Saidapur Cabin	KA	YAD	SCR	GTL
SAIN	Saidapur North	KA	YAD	SCR	GTL
GDL	Gondal	GJ	RJT	WR	RJT
DET	Dehtora	UP	AGA	NCR	AGC
GDG	Gadag Junction	KA	GAD	SWR	UBL
SANR	Sanganer	RJ	JP	NWR	JP
SAS	Sahibzada Ajitsingh Nagar	PB	SAS	NR	UMB
VDI	Viddalur	AP	CTT	SCR	GTL
DOZ	Daurai	RJ	AII	NWR	AII
SCGR	Subhash Nagar	DL	NDL	NR	DLI
SCM	Simhachalam	AP	VSK	ECoR	WAT
SCPS	Simhachalam Siding	AP	VSK	ECoR	WAT
SEE	Sonpur Junction	BR	SAR	ECR	SEE
FCIV	FCI Siding Vadodara	GJ	BRD	WR	BRCP
SFMU	Safapora	JK	BAR	NR	FZR
SFY	Shajapur	MP	SHA	WR	RTM
SHM	Shalimar	WB	HOW	SER	KGP
SIOB	Samakhiali Junction	GJ	KUT	WR	ADI
SKHV	Shrikaranpur	RJ	SGNR	NWR	BKN
VKB	Vikarabad Junction	TS	RR	SCR	SC
GDA	Godhra Outer	GJ	PAN	WR	BRCP
VR	Virar	MH	PAL	WR	BCT
VSPT	Visakhapatnam Terminal	AP	VSK	ECoR	WAT
SMT	Salem Market	TN	SAL	SR	SA
ANND	Anand Junction	GJ	AHM	WR	ADI
AKVD	Akividu	AP	WG	SCR	BZA
FZP	Firozpur City	PB	FZR	NR	FZR
AKT	Akaltara	CG	JAN	SECR	BSP
FL	Phulera Junction	RJ	JP	NWR	JP
ABS	Abohar Junction	PB	FZR	NR	FZR
AJJ	Arakkonam Junction	TN	VELL	SR	MAS
KSAG	Keshod Goods	GJ	JUN	WR	BVP
SSMK	Shamshabad Model	UP	FBD	NER	IZN
KSX	Kotshila Junction	WB	PUR	SER	ADRA
FCGD	FCI Siding Gonda	UP	GON	NER	GD
KTYM	Kottayam	KL	KOT	SR	TVC
KURT	Kurukshetra Junction	HR	KUR	NR	DLI
KRPU	Koraput Yard	OR	KOR	ECoR	WAT
KYX	Kural	WB	MID	SER	KGP
FCMI	FCI Siding Indore	MP	IND	WR	RTM
BUW	Burhwal Junction	UP	BAR	NER	GD
BTD	Botad Junction	GJ	BOT	WR	BVP
STBD	Sitapur Beach	UP	SIT	NER	IZN
WCGS	Wani Coal Goods	MH	YAT	CR	NGP
KRNT	Kurnool City	AP	KUR	SCR	GTL
BRRG	Biyavara Rajgarh	MP	RAJ	WCR	BPL
`;

async function main() {
  const lines = rawData.trim().split('\n').filter(Boolean);
  let upsertedCount = 0;
  const parsedRecords = [];

  for (const line of lines) {
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length < 2) continue;
    const [stationCode, stationName, state, district, zone, division] = parts;
    if (!stationCode || stationCode === 'StationCode') continue;

    parsedRecords.push({
      id: `stn_${stationCode.toUpperCase()}`,
      station_code: stationCode.toUpperCase(),
      code: stationCode.toUpperCase(),
      station_name: stationName || stationCode.toUpperCase(),
      name: stationName || stationCode.toUpperCase(),
      state: state || null,
      district: district || null,
      zone: zone || null,
      division: division || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
  }

  // 1. Attempt PostgreSQL import
  let pgSuccess = false;
  try {
    const DATABASE_URL = process.env.DATABASE_URL || "postgresql://fois_user:fois_password@localhost:5432/fois_db";
    const pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS station_master (
        id TEXT PRIMARY KEY,
        station_code TEXT UNIQUE NOT NULL,
        station_name TEXT NOT NULL,
        district TEXT,
        state TEXT,
        division TEXT,
        zone TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const codes = parsedRecords.map(r => r.station_code);

    for (const r of parsedRecords) {
      await pool.query(
        `INSERT INTO station_master (id, station_code, station_name, state, district, zone, division, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
         ON CONFLICT (station_code) DO UPDATE SET
           station_name = EXCLUDED.station_name,
           state = COALESCE(EXCLUDED.state, station_master.state),
           district = COALESCE(EXCLUDED.district, station_master.district),
           zone = COALESCE(EXCLUDED.zone, station_master.zone),
           division = COALESCE(EXCLUDED.division, station_master.division),
           updated_at = NOW()`,
        [r.id, r.station_code, r.station_name, r.state, r.district, r.zone, r.division]
      );
      upsertedCount++;
    }

    if (codes.length > 0) {
      await pool.query(
        `DELETE FROM unmapped_station_codes WHERE station_code = ANY($1::text[])`,
        [codes]
      );
    }
    console.log(`[PG Storage] Successfully upserted ${upsertedCount} station master records into PostgreSQL station_master table!`);
    await pool.end();
    pgSuccess = true;
  } catch (err) {
    console.info(`[PG Storage] PostgreSQL not available (${err.message}). Updating JSON DB storage...`);
  }

  // 2. Always update JSON storage (server/data/db.json) as well
  try {
    const db = await readDb();
    const existing = Array.isArray(db.station_master) ? db.station_master : [];
    const map = new Map();
    for (const item of existing) {
      if (item.station_code || item.code) {
        map.set((item.station_code || item.code).toUpperCase(), item);
      }
    }

    for (const r of parsedRecords) {
      map.set(r.station_code, {
        ...(map.get(r.station_code) || {}),
        ...r,
      });
    }

    db.station_master = Array.from(map.values());
    await writeDb(db);
    console.log(`[JSON Storage] Successfully saved ${parsedRecords.length} total station master records to db.json!`);
  } catch (err) {
    console.error('[JSON Storage] Failed to update db.json:', err.message);
  }

  console.log('✅ Station Master update complete!');
}

main().catch(err => {
  console.error('Import script error:', err);
  process.exit(1);
});
