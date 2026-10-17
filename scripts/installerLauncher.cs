/*
 * 971 Client Setup
 * Copyright (c) 2026 971 Client contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("971 Client Setup")]
[assembly: AssemblyDescription("Install, repair, or remove 971 Client")]
[assembly: AssemblyCompany("971 Client")]
[assembly: AssemblyProduct("971 Client")]
[assembly: AssemblyCopyright("Credits to @kk5a - kbk; GPL-3.0-or-later")]
[assembly: AssemblyVersion("2.2.8.7")]
[assembly: AssemblyFileVersion("2.2.8.7")]

internal static class InstallerLauncher
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new InstallerWindow());
    }
}

internal sealed class InstallerWindow : Form
{
    private const string ExpectedCliHash = "BFAAF16E952070825FDABDEEE1DD5A10C3351E7BB69E794268D33F612283101A";
    private const int WmNcLButtonDown = 0xA1;
    private const int HtCaption = 0x2;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);

    private readonly Color _background = Color.FromArgb(17, 19, 26);
    private readonly Color _panel = Color.FromArgb(26, 29, 39);
    private readonly Color _muted = Color.FromArgb(157, 165, 181);
    private readonly Color _accent = Color.FromArgb(139, 153, 255);
    private Panel _mainPanel;
    private Label _heading;
    private Label _intro;
    private Label _optionsLabel;
    private Panel _statusPanel;
    private Label _statusDot;
    private Label _footer;
    private LinkLabel _supportLink;
    private ActionButton _detailsButton;
    private bool _detailsExpanded;
    private Label _statusTitle;
    private Label _statusDetail;
    private ProgressBar _progress;
    private RichTextBox _log;
    private ActionButton[] _actionButtons;
    private DiscordTarget _selectedTarget;
    private DiscordTargetCard[] _targetCards;
    private Label _targetSummary;
    private ActionButton _browseTargetButton;
    private bool _busy;

    internal InstallerWindow()
    {
        Text = "971 Client";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        MinimizeBox = true;
        MaximizeBox = true;
        ShowInTaskbar = true;
        BackColor = _background;
        ForeColor = Color.FromArgb(224, 228, 238);
        ClientSize = new Size(920, 560);
        MinimumSize = new Size(840, 520);
        DoubleBuffered = true;
        Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

        _mainPanel = BuildMainPanel(out _statusTitle, out _statusDetail, out _progress, out _log, out _actionButtons, out _targetCards, out _targetSummary, out _browseTargetButton);
        Panel titleBar = BuildTitleBar();

        Controls.Add(_mainPanel);
        Controls.Add(titleBar);
        Resize += delegate { ApplyWindowShape(); LayoutMainPanel(); };
        FormClosing += HandleFormClosing;

        PopulateDiscordTargets();
        LayoutMainPanel();
        ApplyWindowShape();

        SetStatus("Ready when you are", "Choose an option to install, repair, or remove the client.", _muted);
        AppendLog("971 Client Setup is ready.");
    }

    private Panel BuildTitleBar()
    {
        Panel bar = new Panel();
        bar.Dock = DockStyle.Top;
        bar.Height = 48;
        bar.BackColor = Color.FromArgb(21, 23, 31);

        WindowControlButton close = new WindowControlButton(WindowControlKind.Close);
        close.Location = new Point(16, 17);
        close.Click += delegate { Close(); };
        bar.Controls.Add(close);

        WindowControlButton minimize = new WindowControlButton(WindowControlKind.Minimize);
        minimize.Location = new Point(38, 17);
        minimize.Click += delegate { WindowState = FormWindowState.Minimized; };
        bar.Controls.Add(minimize);

        WindowControlButton zoom = new WindowControlButton(WindowControlKind.Zoom);
        zoom.Location = new Point(60, 17);
        zoom.Click += delegate { WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; };
        bar.Controls.Add(zoom);

        LogoMark mark = new LogoMark();
        mark.Location = new Point(91, 10);
        mark.Size = new Size(28, 28);
        bar.Controls.Add(mark);

        Label title = MakeLabel("971 Client", 10F, FontStyle.Bold, Color.FromArgb(224, 228, 238));
        title.Location = new Point(128, 10);
        title.Size = new Size(160, 28);
        bar.Controls.Add(title);

        bar.MouseDown += DragWindow;
        mark.MouseDown += DragWindow;
        title.MouseDown += DragWindow;
        return bar;
    }

    private Panel BuildMainPanel(out Label statusTitle, out Label statusDetail, out ProgressBar progress, out RichTextBox log, out ActionButton[] actionButtons, out DiscordTargetCard[] targetCards, out Label targetSummary, out ActionButton browseTargetButton)
    {
        Panel main = new Panel();
        main.Dock = DockStyle.Fill;
        main.BackColor = _background;

        _heading = MakeLabel("Install 971 Client", 20F, FontStyle.Bold, Color.FromArgb(231, 233, 241));
        main.Controls.Add(_heading);

        _intro = MakeLabel("Choose a Discord installation.", 9F, FontStyle.Regular, _muted);
        main.Controls.Add(_intro);

        _optionsLabel = MakeLabel("Discord installation", 9F, FontStyle.Bold, Color.FromArgb(193, 199, 213));
        main.Controls.Add(_optionsLabel);

        browseTargetButton = new ActionButton("Browse…", ButtonStyle.Secondary);
        browseTargetButton.Size = new Size(92, 30);
        browseTargetButton.Click += delegate { BrowseForDiscordTarget(); };
        main.Controls.Add(browseTargetButton);

        DiscordTargetCard[] cards = new DiscordTargetCard[3];
        targetCards = cards;
        string[] channelNames = new string[] { "Discord Stable", "Discord PTB", "Discord Canary" };
        for (int i = 0; i < cards.Length; i++)
        {
            int cardIndex = i;
            DiscordTargetCard card = new DiscordTargetCard(channelNames[i], _panel, _accent, _muted);
            card.Size = new Size(190, 68);
            card.TargetSelected += delegate { SelectTarget(cards[cardIndex].Target); };
            cards[i] = card;
            main.Controls.Add(card);
        }

        targetSummary = MakeLabel("No Discord installation selected", 8F, FontStyle.Regular, _muted);
        targetSummary.AutoEllipsis = true;
        main.Controls.Add(targetSummary);

        actionButtons = new ActionButton[3];
        actionButtons[0] = new ActionButton("Install / Update", ButtonStyle.Primary);
        actionButtons[1] = new ActionButton("Repair", ButtonStyle.Secondary);
        actionButtons[2] = new ActionButton("Uninstall", ButtonStyle.Danger);
        string[] actions = new string[] { "--install", "--repair", "--uninstall" };
        for (int i = 0; i < actionButtons.Length; i++)
        {
            int actionIndex = i;
            actionButtons[i].Size = new Size(190, 40);
            actionButtons[i].Click += delegate { BeginOperation(actions[actionIndex]); };
            main.Controls.Add(actionButtons[i]);
        }

        RoundedSurfacePanel status = new RoundedSurfacePanel(_panel, Color.FromArgb(49, 53, 68), 12);
        _statusPanel = status;
        main.Controls.Add(status);

        _statusDot = MakeLabel("●", 10F, FontStyle.Bold, _accent);
        status.Controls.Add(_statusDot);

        statusTitle = MakeLabel("Ready", 9.5F, FontStyle.Bold, Color.FromArgb(224, 228, 238));
        status.Controls.Add(statusTitle);

        statusDetail = MakeLabel("Quit Discord fully before installing or repairing.", 8.5F, FontStyle.Regular, _muted);
        status.Controls.Add(statusDetail);

        progress = new ProgressBar();
        _progress = progress;
        progress.Style = ProgressBarStyle.Continuous;
        progress.Value = 0;
        progress.BackColor = _panel;
        main.Controls.Add(progress);

        log = new RichTextBox();
        log.ReadOnly = true;
        log.BorderStyle = BorderStyle.None;
        log.BackColor = Color.FromArgb(12, 14, 20);
        log.ForeColor = Color.FromArgb(183, 190, 207);
        log.Font = new Font("Consolas", 8F, FontStyle.Regular, GraphicsUnit.Point);
        log.DetectUrls = false;
        log.ScrollBars = RichTextBoxScrollBars.Vertical;
        log.Visible = false;
        main.Controls.Add(log);

        _detailsButton = new ActionButton("Show details", ButtonStyle.Secondary);
        _detailsButton.Size = new Size(112, 28);
        _detailsButton.Click += delegate { SetDetailsExpanded(!_detailsExpanded, true); };
        main.Controls.Add(_detailsButton);

        _footer = MakeLabel("Credits to @kk5a - kbk", 8F, FontStyle.Regular, Color.FromArgb(124, 132, 151));
        main.Controls.Add(_footer);

        _supportLink = new LinkLabel();
        _supportLink.Text = "discord.gg/dhabi";
        _supportLink.LinkColor = _accent;
        _supportLink.ActiveLinkColor = Color.FromArgb(190, 198, 255);
        _supportLink.VisitedLinkColor = _accent;
        _supportLink.LinkBehavior = LinkBehavior.HoverUnderline;
        _supportLink.Font = new Font("Segoe UI", 8F, FontStyle.Regular, GraphicsUnit.Point);
        _supportLink.BackColor = main.BackColor;
        _supportLink.Size = new Size(160, 20);
        _supportLink.TextAlign = ContentAlignment.MiddleRight;
        _supportLink.LinkClicked += delegate {
            try { Process.Start(new ProcessStartInfo("https://discord.gg/dhabi") { UseShellExecute = true }); } catch { }
        };
        main.Controls.Add(_supportLink);

        return main;
    }

    private void LayoutMainPanel()
    {
        if (_mainPanel == null || _targetCards == null || _actionButtons == null) return;

        int left = 34;
        int contentWidth = Math.Max(500, _mainPanel.ClientSize.Width - left * 2);
        int groupHeight = _detailsExpanded ? 525 : 445;
        int top = Math.Max(16, (_mainPanel.ClientSize.Height - groupHeight) / 2);
        int targetGap = 12;
        int targetWidth = (contentWidth - targetGap * 2) / 3;

        _heading.SetBounds(left, top + 4, contentWidth, 34);
        _intro.SetBounds(left + 1, top + 37, contentWidth, 24);
        _optionsLabel.SetBounds(left + 1, top + 75, contentWidth - 110, 24);
        _browseTargetButton.SetBounds(_mainPanel.ClientSize.Width - left - 92, top + 72, 92, 30);

        for (int i = 0; i < _targetCards.Length; i++)
            _targetCards[i].SetBounds(left + i * (targetWidth + targetGap), top + 110, targetWidth, 68);

        _targetSummary.SetBounds(left + 2, top + 181, contentWidth, 21);

        int actionGap = 10;
        int actionWidth = (contentWidth - actionGap * 2) / 3;
        for (int i = 0; i < _actionButtons.Length; i++)
            _actionButtons[i].SetBounds(left + i * (actionWidth + actionGap), top + 211, actionWidth, 40);

        _statusPanel.SetBounds(left, top + 265, contentWidth, 58);
        _statusDot.SetBounds(15, 17, 20, 22);
        _statusTitle.SetBounds(42, 7, contentWidth - 56, 21);
        _statusDetail.SetBounds(43, 29, contentWidth - 58, 21);
        _progress.SetBounds(left, top + 337, contentWidth, 7);
        _detailsButton.SetBounds(left, top + 354, 112, 28);
        _log.SetBounds(left, top + 390, contentWidth, 82);
        _footer.SetBounds(left + 2, top + (_detailsExpanded ? 487 : 399), 280, 22);
        _supportLink.SetBounds(_mainPanel.ClientSize.Width - left - 160, top + (_detailsExpanded ? 488 : 400), 160, 20);
    }

    private void SetDetailsExpanded(bool expanded, bool resizeWindow)
    {
        if (_detailsExpanded == expanded) return;
        _detailsExpanded = expanded;
        _log.Visible = expanded;
        _detailsButton.Text = expanded ? "Hide details" : "Show details";
        if (resizeWindow && WindowState != FormWindowState.Maximized)
            ClientSize = new Size(920, expanded ? 660 : 560);
        LayoutMainPanel();
    }

    private void ApplyWindowShape()
    {
        if (ClientSize.Width < 32 || ClientSize.Height < 32) return;
        using (GraphicsPath path = new GraphicsPath())
        {
            Rectangle bounds = new Rectangle(0, 0, ClientSize.Width, ClientSize.Height);
            if (WindowState == FormWindowState.Maximized)
                path.AddRectangle(bounds);
            else
            {
                using (GraphicsPath rounded = RoundedRectangle(bounds, 16))
                    path.AddPath(rounded, false);
            }
            Region oldRegion = Region;
            Region = new Region(path);
            if (oldRegion != null) oldRegion.Dispose();
        }
    }

    private void PopulateDiscordTargets()
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string stablePath = Path.Combine(localAppData, "Discord");
        string ptbPath = Path.Combine(localAppData, "DiscordPTB");
        string canaryPath = Path.Combine(localAppData, "DiscordCanary");
        string developmentPath = Path.Combine(localAppData, "DiscordDevelopment");
        DiscordTarget[] targets = new DiscordTarget[] {
            new DiscordTarget("Discord Stable — " + stablePath, "stable", stablePath, false),
            new DiscordTarget("Discord PTB — " + ptbPath, "ptb", ptbPath, false),
            new DiscordTarget("Discord Canary — " + canaryPath, "canary", canaryPath, false)
        };

        string iconSource = FindDiscordExecutable(stablePath);
        if (iconSource == null) iconSource = FindDiscordExecutable(ptbPath);
        if (iconSource == null) iconSource = FindDiscordExecutable(canaryPath);
        if (iconSource == null) iconSource = FindDiscordExecutable(developmentPath);
        Image appIcon = LoadDiscordIcon(iconSource);

        for (int i = 0; i < targets.Length; i++)
        {
            bool installed = LooksLikeDiscordInstall(targets[i].Location);
            string executablePath = FindDiscordExecutable(targets[i].Location);
            Image channelIcon = executablePath == null ? CloneImage(appIcon) : LoadDiscordIcon(executablePath);
            _targetCards[i].SetTarget(targets[i], installed, channelIcon);
            if (_selectedTarget == null && installed) _selectedTarget = targets[i];
        }

        bool developmentInstalled = LooksLikeDiscordInstall(developmentPath);
        if (_selectedTarget == null && developmentInstalled)
            _selectedTarget = new DiscordTarget("Discord Development — " + developmentPath, "development", developmentPath, false);

        if (appIcon != null) appIcon.Dispose();
        UpdateSelectedTargetDisplay();
    }

    private static string FindDiscordExecutable(string location)
    {
        if (String.IsNullOrWhiteSpace(location) || !Directory.Exists(location)) return null;
        try
        {
            string[] appDirectories = Directory.GetDirectories(location, "app-*", SearchOption.TopDirectoryOnly);
            Version newestVersion = null;
            string newestExecutable = null;
            for (int i = 0; i < appDirectories.Length; i++)
            {
                string directoryName = Path.GetFileName(appDirectories[i]);
                Version version;
                if (directoryName == null || !directoryName.StartsWith("app-", StringComparison.OrdinalIgnoreCase) ||
                    !Version.TryParse(directoryName.Substring(4), out version)) continue;
                string executable = Path.Combine(appDirectories[i], "Discord.exe");
                if (!File.Exists(executable)) continue;
                if (newestVersion == null || version.CompareTo(newestVersion) > 0)
                {
                    newestVersion = version;
                    newestExecutable = executable;
                }
            }
            return newestExecutable;
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    private static Image LoadDiscordIcon(string executablePath)
    {
        if (!String.IsNullOrWhiteSpace(executablePath))
        {
            try
            {
                using (Icon icon = Icon.ExtractAssociatedIcon(executablePath))
                    if (icon != null) return icon.ToBitmap();
            }
            catch { }
        }
        return CreateDiscordFallbackIcon();
    }

    private static Image CloneImage(Image image)
    {
        if (image == null) return CreateDiscordFallbackIcon();
        return (Image)image.Clone();
    }

    private static Image CreateDiscordFallbackIcon()
    {
        Bitmap bitmap = new Bitmap(48, 48);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle bounds = new Rectangle(1, 1, 46, 46);
            using (GraphicsPath background = RoundedRectangle(bounds, 13))
            using (LinearGradientBrush brush = new LinearGradientBrush(bounds, Color.FromArgb(88, 101, 242), Color.FromArgb(112, 126, 255), 35F))
                graphics.FillPath(brush, background);
            using (Font font = new Font("Segoe UI", 28F, FontStyle.Bold, GraphicsUnit.Pixel))
            using (SolidBrush brush = new SolidBrush(Color.FromArgb(232, 235, 244)))
            using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                graphics.DrawString("D", font, brush, new RectangleF(2, 1, 44, 45), format);
        }
        return bitmap;
    }

    internal static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static bool LooksLikeDiscordInstall(string location)
    {
        if (String.IsNullOrWhiteSpace(location) || !Directory.Exists(location)) return false;

        try
        {
            string[] appDirectories = Directory.GetDirectories(location, "app-*", SearchOption.TopDirectoryOnly);
            for (int i = 0; i < appDirectories.Length; i++)
            {
                string appDirectory = appDirectories[i];
                if (File.Exists(Path.Combine(appDirectory, "Discord.exe")) &&
                    Directory.Exists(Path.Combine(appDirectory, "resources")))
                    return true;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }

        return false;
    }

    private void BrowseForDiscordTarget()
    {
        string initialPath = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (_selectedTarget != null && !String.IsNullOrWhiteSpace(_selectedTarget.Location))
            initialPath = _selectedTarget.Location;

        using (FolderBrowserDialog picker = new FolderBrowserDialog())
        {
            picker.Description = "Choose the Discord install folder containing its app-version folder.";
            picker.ShowNewFolderButton = false;
            picker.SelectedPath = initialPath;
            if (picker.ShowDialog(this) != DialogResult.OK) return;

            string location;
            try { location = Path.GetFullPath(picker.SelectedPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar); }
            catch (Exception exception)
            {
                MessageBox.Show(this, "That folder path could not be used.\n\n" + exception.Message, "Invalid Discord folder", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (!LooksLikeDiscordInstall(location))
            {
                MessageBox.Show(this,
                    "This folder does not look like a Discord installation. Choose the folder that contains the app-version folder, such as Discord\\app-1.0.x.",
                    "Discord folder not found", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            DiscordTarget custom = new DiscordTarget("Custom — " + location, null, location, true);
            SelectTarget(custom);
        }
    }

    private void SelectTarget(DiscordTarget target)
    {
        if (target == null) return;
        _selectedTarget = target;
        UpdateSelectedTargetDisplay();
    }

    private void UpdateSelectedTargetDisplay()
    {
        for (int i = 0; i < _targetCards.Length; i++)
            _targetCards[i].Selected = _selectedTarget != null && Object.ReferenceEquals(_targetCards[i].Target, _selectedTarget);

        if (_selectedTarget == null)
            _targetSummary.Text = "No Discord installation selected";
        else
            _targetSummary.Text = "Selected: " + _selectedTarget.Name + " · " + Path.GetFileName(_selectedTarget.Location);
    }

    private void BeginOperation(string action)
    {
        if (_busy) return;

        DiscordTarget target = _selectedTarget;
        if (target == null || (!target.IsCustom && (target.Branch == null || !LooksLikeDiscordInstall(target.Location))))
        {
            SetStatus("Choose a Discord install", "Select a detected install or browse to its Discord folder first.", Color.FromArgb(247, 194, 105));
            AppendLog("Choose a Discord install before starting setup.");
            return;
        }

        int runningProcesses = GetDiscordProcessCount(target);
        if (runningProcesses > 0)
        {
            string processMessage = "Found " + runningProcesses + " running Discord process" + (runningProcesses == 1 ? "" : "es") + ". Quit Discord from the system tray and wait for every process to close.";
            SetStatus("Close this Discord install", processMessage, Color.FromArgb(247, 194, 105));
            AppendLog(processMessage + " No files were changed; retry after it has fully exited.");
            return;
        }

        if (action == "--uninstall")
        {
            DialogResult result = MessageBox.Show(this,
                "Remove the 971 Client integration from Discord? Your Discord account and messages are not affected.",
                "Confirm removal", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (result != DialogResult.Yes) return;
        }

        _busy = true;
        _progress.Style = ProgressBarStyle.Marquee;
        _progress.MarqueeAnimationSpeed = 24;
        _progress.Value = 0;
        SetButtonsEnabled(false);
        SetStatus("Preparing " + target.Name, "Checking the bundled files and preparing a safe package location.", _accent);
        AppendLog("Starting " + ActionName(action) + "...");
        AppendLog("Discord target: " + target.DisplayName);
        ThreadPool.QueueUserWorkItem(delegate { RunOperation(action, target); });
    }

    private void RunOperation(string action, DiscordTarget target)
    {
        string workDir = Path.Combine(Path.GetTempPath(), "971Client-Setup-" + Guid.NewGuid().ToString("N"));
        int exitCode = 1;
        string failure = null;

        try
        {
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "971 Client");
            Directory.CreateDirectory(dataDir);
            string packagePath = ExtractVersionedPackage(dataDir);

            int remainingProcesses = GetDiscordProcessCount(target);
            if (remainingProcesses > 0)
                throw new InvalidOperationException("Discord reopened before patching. Found " + remainingProcesses + " running process" + (remainingProcesses == 1 ? "" : "es") + "; no Discord files were changed. Fully exit Discord and retry.");

            if (TryHandleFolderShim(action, target, packagePath))
            {
                exitCode = 0;
            }
            else
            {
                Directory.CreateDirectory(workDir);
                string cliPath = ExtractResource("installer-cli.exe", Path.Combine(workDir, "installer-cli.exe"));
                string actualCliHash = HashFile(cliPath);
                if (!String.Equals(actualCliHash, ExpectedCliHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The embedded installer did not pass its SHA-256 integrity check.");

                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = cliPath;
                start.WorkingDirectory = workDir;
                start.UseShellExecute = false;
                start.Arguments = BuildInstallerArguments(action, target);
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                SetInstallerEnvironment(start, "TESTCORD_DIRECTORY", packagePath);
                SetInstallerEnvironment(start, "TESTCORD_USER_DATA_DIR", dataDir);
                SetInstallerEnvironment(start, "TESTCORD_DEV_INSTALL", "1");
                SetInstallerEnvironment(start, "EQUICORD_DIRECTORY", packagePath);
                SetInstallerEnvironment(start, "EQUICORD_USER_DATA_DIR", dataDir);
                SetInstallerEnvironment(start, "EQUICORD_DEV_INSTALL", "1");

                using (Process process = new Process())
                {
                    process.StartInfo = start;
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) {
                        if (eventArgs.Data != null) AppendLog(NormalizeInstallerText(eventArgs.Data));
                    };
                    process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) {
                        if (eventArgs.Data != null) AppendLog(NormalizeInstallerText(eventArgs.Data));
                    };

                    remainingProcesses = GetDiscordProcessCount(target);
                    if (remainingProcesses > 0)
                        throw new InvalidOperationException("Discord reopened before patching. Found " + remainingProcesses + " running process" + (remainingProcesses == 1 ? "" : "es") + "; no Discord files were changed. Fully exit Discord and retry.");
                    AppendLog("Verified 971 Client package. Launching the installer with detailed diagnostics...");
                    if (!process.Start()) throw new InvalidOperationException("Windows could not start the embedded installer.");
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    process.WaitForExit();
                    process.WaitForExit();
                    exitCode = process.ExitCode;
                }
            }
        }
        catch (Exception exception)
        {
            failure = exception.Message;
        }
        finally
        {
            try { if (Directory.Exists(workDir)) Directory.Delete(workDir, true); } catch { }
        }

        int resultCode = exitCode;
        string resultFailure = failure;
        BeginInvoke((MethodInvoker)delegate { FinishOperation(action, resultCode, resultFailure); });
    }

    private void FinishOperation(string action, int exitCode, string failure)
    {
        _busy = false;
        _progress.MarqueeAnimationSpeed = 0;
        _progress.Style = ProgressBarStyle.Continuous;
        SetButtonsEnabled(true);

        if (failure != null)
        {
            _progress.Value = 0;
            SetStatus("Setup could not finish", failure, Color.FromArgb(247, 120, 133));
            AppendLog("Error: " + failure);
            SetDetailsExpanded(true, true);
            return;
        }

        if (exitCode != 0)
        {
            _progress.Value = 0;
            SetStatus("Operation did not finish", "The installer returned code " + exitCode + ". Review the details above and try Repair if needed.", Color.FromArgb(247, 120, 133));
            AppendLog("Installer finished with exit code " + exitCode + ".");
            SetDetailsExpanded(true, true);
            return;
        }

        _progress.Value = 100;
        string status = action == "--uninstall" ? "971 Client removed" : "971 Client is ready";
        string detail = action == "--uninstall"
            ? "Discord has been restored. You can close this window."
            : "Installation finished. Reopen Discord to start using 971 Client.";
        SetStatus(status, detail, _accent);
        AppendLog(action == "--uninstall" ? "Removal completed successfully." : "Installation completed successfully.");
    }

    private void SetButtonsEnabled(bool enabled)
    {
        for (int i = 0; i < _actionButtons.Length; i++) _actionButtons[i].Enabled = enabled;
        for (int i = 0; i < _targetCards.Length; i++) _targetCards[i].Enabled = enabled && _targetCards[i].Available;
        _browseTargetButton.Enabled = enabled;
    }

    private static string BuildInstallerArguments(string action, DiscordTarget target)
    {
        if (target.IsCustom)
            return action + " --debug --location " + QuoteWindowsArgument(target.Location);

        return action + " --debug --branch " + QuoteWindowsArgument(target.Branch);
    }

    private bool TryHandleFolderShim(string action, DiscordTarget target, string packagePath)
    {
        string resources = FindNewestDiscordResources(target);
        if (resources == null) return false;

        string appArchive = Path.Combine(resources, "app.asar");
        string originalArchive = Path.Combine(resources, "_app.asar");
        bool appIsFile = File.Exists(appArchive);
        bool appIsDirectory = Directory.Exists(appArchive);
        bool originalExists = File.Exists(originalArchive);

        if (appIsDirectory)
        {
            if (!originalExists || !Is971FolderShim(appArchive))
                throw new IOException("Discord has an app.asar folder that 971 Client cannot safely identify. No Discord files were changed.");

            if (action == "--uninstall")
            {
                RestoreOriginalArchive(appArchive, originalArchive);
                AppendLog("Removed the verified 971 Client folder shim and restored Discord's original archive.");
            }
            else
            {
                WriteShimEntryPoint(appArchive, packagePath);
                AppendLog("Updated the verified 971 Client folder shim. Discord's original _app.asar archive was preserved.");
            }
            return true;
        }

        if (!appIsFile && !originalExists)
            throw new FileNotFoundException("The selected Discord version has neither app.asar nor _app.asar. No Discord files were changed.");

        if (!appIsFile && originalExists)
        {
            if (action == "--uninstall")
            {
                File.Move(originalArchive, appArchive);
                AppendLog("Restored Discord's original archive from _app.asar.");
            }
            else
            {
                CreateFolderShim(appArchive, originalArchive, packagePath);
                AppendLog("Installed the 971 Client folder shim while retaining Discord's original _app.asar archive.");
            }
            return true;
        }

        if (appIsFile && !originalExists)
        {
            if (action == "--uninstall")
            {
                AppendLog("Discord is already unmodified; there was no 971 Client patch to remove.");
            }
            else
            {
                CreateFolderShim(appArchive, originalArchive, packagePath);
                AppendLog("Installed the 971 Client folder shim and retained Discord's original app.asar as _app.asar.");
            }
            return true;
        }

        // Older archive-based installs are still supported by the bundled CLI.
        return false;
    }

    private static string FindNewestDiscordResources(DiscordTarget target)
    {
        if (target == null || String.IsNullOrWhiteSpace(target.Location) || !Directory.Exists(target.Location)) return null;

        string[] appDirectories;
        try { appDirectories = Directory.GetDirectories(target.Location, "app-*", SearchOption.TopDirectoryOnly); }
        catch { return null; }

        Version newestVersion = null;
        string newestResources = null;
        for (int i = 0; i < appDirectories.Length; i++)
        {
            string directoryName = Path.GetFileName(appDirectories[i]);
            Version version;
            if (directoryName == null || !directoryName.StartsWith("app-", StringComparison.OrdinalIgnoreCase) ||
                !Version.TryParse(directoryName.Substring(4), out version)) continue;

            string resources = Path.Combine(appDirectories[i], "resources");
            if (!Directory.Exists(resources)) continue;
            if (newestVersion == null || version.CompareTo(newestVersion) > 0)
            {
                newestVersion = version;
                newestResources = resources;
            }
        }
        return newestResources;
    }

    private static bool Is971FolderShim(string appArchiveDirectory)
    {
        try
        {
            if ((File.GetAttributes(appArchiveDirectory) & FileAttributes.ReparsePoint) != 0) return false;
            string[] files = Directory.GetFiles(appArchiveDirectory, "*", SearchOption.TopDirectoryOnly);
            string[] directories = Directory.GetDirectories(appArchiveDirectory, "*", SearchOption.TopDirectoryOnly);
            if (files.Length != 2 || directories.Length != 0) return false;
            for (int i = 0; i < files.Length; i++)
                if ((File.GetAttributes(files[i]) & FileAttributes.ReparsePoint) != 0) return false;

            string packageFile = Path.Combine(appArchiveDirectory, "package.json");
            string entryFile = Path.Combine(appArchiveDirectory, "index.js");
            if (!File.Exists(packageFile) || !File.Exists(entryFile)) return false;
            if (!String.Equals(File.ReadAllText(packageFile).Trim(), "{\"name\":\"discord\",\"main\":\"index.js\"}", StringComparison.Ordinal)) return false;

            string entry = File.ReadAllText(entryFile).Trim();
            const string prefix = "require(\"";
            const string suffix = "\");";
            if (!entry.StartsWith(prefix, StringComparison.Ordinal) || !entry.EndsWith(suffix, StringComparison.Ordinal)) return false;

            string escapedPath = entry.Substring(prefix.Length, entry.Length - prefix.Length - suffix.Length);
            string patcherPath = escapedPath.Replace("\\\\", "\\").Replace("\\\"", "\"");
            if (!patcherPath.EndsWith("\\patcher.js", StringComparison.OrdinalIgnoreCase)) return false;

            string packageArchive = patcherPath.Substring(0, patcherPath.Length - "\\patcher.js".Length);
            string packagesDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "971 Client", "packages");
            string fileName = Path.GetFileName(packageArchive);
            return IsWithinInstall(packageArchive, packagesDirectory) &&
                fileName.StartsWith("desktop-", StringComparison.OrdinalIgnoreCase) &&
                fileName.EndsWith(".asar", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static void CreateFolderShim(string appArchive, string originalArchive, string packagePath)
    {
        if (Directory.Exists(appArchive)) throw new IOException("A folder already exists at Discord's app.asar path.");
        if (Directory.Exists(originalArchive)) throw new IOException("Discord's _app.asar backup path is a folder; refusing to change it.");

        bool movedOriginal = false;
        bool createdShim = false;
        try
        {
            if (File.Exists(appArchive))
            {
                if (File.Exists(originalArchive)) throw new IOException("Both app.asar and _app.asar already exist; refusing to overwrite either file.");
                File.Move(appArchive, originalArchive);
                movedOriginal = true;
            }
            else if (!File.Exists(originalArchive))
            {
                throw new FileNotFoundException("Discord's original app.asar archive is missing.", originalArchive);
            }

            Directory.CreateDirectory(appArchive);
            createdShim = true;
            File.WriteAllText(Path.Combine(appArchive, "package.json"), "{\"name\":\"discord\",\"main\":\"index.js\"}", new UTF8Encoding(false));
            WriteShimEntryPoint(appArchive, packagePath);
        }
        catch (Exception exception)
        {
            string rollbackError = null;
            try { if (createdShim && Directory.Exists(appArchive)) Directory.Delete(appArchive, true); }
            catch (Exception rollback) { rollbackError = rollback.Message; }
            try
            {
                if (movedOriginal && File.Exists(originalArchive) && !File.Exists(appArchive) && !Directory.Exists(appArchive))
                    File.Move(originalArchive, appArchive);
            }
            catch (Exception rollback) { rollbackError = rollback.Message; }

            if (rollbackError != null)
                throw new IOException("The folder shim could not be created, and automatic rollback also failed: " + rollbackError + ". Original files are retained at " + originalArchive, exception);
            throw;
        }
    }

    private static void WriteShimEntryPoint(string appArchiveDirectory, string packagePath)
    {
        string patcherPath = Path.Combine(packagePath, "patcher.js");
        string entry = "require(" + QuoteJavaScriptString(patcherPath) + ");";
        string entryPath = Path.Combine(appArchiveDirectory, "index.js");
        string stagingPath = entryPath + ".971client-" + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(stagingPath, entry, new UTF8Encoding(false));
            if (File.Exists(entryPath))
                File.Replace(stagingPath, entryPath, null);
            else
                File.Move(stagingPath, entryPath);
        }
        finally
        {
            try { if (File.Exists(stagingPath)) File.Delete(stagingPath); } catch { }
        }
    }

    private static string QuoteJavaScriptString(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    private static void RestoreOriginalArchive(string shimDirectory, string originalArchive)
    {
        string savedShim = shimDirectory + ".971client-remove-" + Guid.NewGuid().ToString("N");
        Directory.Move(shimDirectory, savedShim);
        try
        {
            File.Move(originalArchive, shimDirectory);
        }
        catch (Exception exception)
        {
            string rollbackError = null;
            try
            {
                if (File.Exists(shimDirectory) && !File.Exists(originalArchive)) File.Move(shimDirectory, originalArchive);
            }
            catch (Exception rollback) { rollbackError = rollback.Message; }
            try
            {
                if (Directory.Exists(savedShim) && !Directory.Exists(shimDirectory) && !File.Exists(shimDirectory))
                    Directory.Move(savedShim, shimDirectory);
            }
            catch (Exception rollback) { rollbackError = rollback.Message; }

            if (rollbackError != null)
                throw new IOException("Discord could not be restored and rollback failed: " + rollbackError + ". The 971 Client shim was kept at " + savedShim, exception);
            throw;
        }

        try { Directory.Delete(savedShim, true); }
        catch { }
    }

    private static string QuoteWindowsArgument(string argument)
    {
        StringBuilder result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;

        for (int i = 0; i < argument.Length; i++)
        {
            char character = argument[i];
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }

            if (backslashes > 0)
            {
                result.Append('\\', backslashes);
                backslashes = 0;
            }
            result.Append(character);
        }

        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private void SetStatus(string title, string detail, Color color)
    {
        _statusTitle.Text = title;
        _statusTitle.ForeColor = color;
        _statusDetail.Text = detail;
    }

    private void AppendLog(string message)
    {
        if (IsDisposed || !IsHandleCreated) return;
        string line = (message ?? String.Empty).TrimEnd();
        try
        {
            if (InvokeRequired)
            {
                BeginInvoke((MethodInvoker)delegate { AppendLog(line); });
                return;
            }

            _log.AppendText(line + Environment.NewLine);
            if (_log.TextLength > 26000)
            {
                _log.Select(0, _log.TextLength - 18000);
                _log.SelectedText = String.Empty;
            }
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        }
        catch (InvalidOperationException) { }
    }

    private static string NormalizeInstallerText(string text)
    {
        return (text ?? String.Empty)
            .Replace("TestCord", "971 Client")
            .Replace("Testcord", "971 Client")
            .Replace("testcord", "971 Client");
    }

    private static string ActionName(string action)
    {
        if (action == "--repair") return "repair";
        if (action == "--uninstall") return "removal";
        return "installation";
    }

    private static int GetDiscordProcessCount(DiscordTarget target)
    {
        string[] names;
        if (target.IsCustom)
            names = new string[] { "Discord", "DiscordCanary", "DiscordPTB", "DiscordDevelopment" };
        else if (target.Branch == "ptb")
            names = new string[] { "DiscordPTB" };
        else if (target.Branch == "canary")
            names = new string[] { "DiscordCanary" };
        else if (target.Branch == "development")
            names = new string[] { "DiscordDevelopment" };
        else
            names = new string[] { "Discord" };

        int count = 0;
        for (int i = 0; i < names.Length; i++)
        {
            Process[] processes;
            try { processes = Process.GetProcessesByName(names[i]); }
            catch { continue; }
            for (int j = 0; j < processes.Length; j++)
            {
                using (Process process = processes[j])
                {
                    try
                    {
                        if (process.HasExited) continue;
                        if (!target.IsCustom)
                        {
                            count++;
                            continue;
                        }

                        string processPath = process.MainModule.FileName;
                        if (IsWithinInstall(processPath, target.Location)) count++;
                    }
                    catch
                    {
                        // A custom install cannot be safely matched when Windows hides its process path.
                        if (target.IsCustom) count++;
                    }
                }
            }
        }
        return count;
    }

    private static bool IsWithinInstall(string processPath, string installPath)
    {
        if (String.IsNullOrWhiteSpace(processPath) || String.IsNullOrWhiteSpace(installPath)) return false;
        try
        {
            string root = Path.GetFullPath(installPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string fullProcessPath = Path.GetFullPath(processPath);
            return fullProcessPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static void SetInstallerEnvironment(ProcessStartInfo start, string key, string value)
    {
        start.EnvironmentVariables[key] = value;
    }

    private static string ExtractVersionedPackage(string dataDir)
    {
        string hash = HashResource("desktop.asar");
        string packageDir = Path.Combine(dataDir, "packages");
        Directory.CreateDirectory(packageDir);

        string packagePath = Path.Combine(packageDir, "desktop-" + hash + ".asar");
        if (File.Exists(packagePath) && !FileMatchesHash(packagePath, hash))
        {
            try { File.Delete(packagePath); } catch { }
            if (File.Exists(packagePath))
                packagePath = Path.Combine(packageDir, "desktop-" + hash + "-" + Guid.NewGuid().ToString("N") + ".asar");
        }

        if (!File.Exists(packagePath))
        {
            string stagingPath = packagePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                ExtractResource("desktop.asar", stagingPath);
                try { File.Move(stagingPath, packagePath); }
                catch (IOException)
                {
                    if (!FileMatchesHash(packagePath, hash)) throw;
                }
            }
            finally
            {
                try { if (File.Exists(stagingPath)) File.Delete(stagingPath); } catch { }
            }
        }

        if (!FileMatchesHash(packagePath, hash))
            throw new IOException("The 971 Client package could not be extracted and verified.");

        return packagePath;
    }

    private static string ExtractResource(string suffix, string path)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        foreach (string name in assembly.GetManifestResourceNames())
        {
            if (!name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) continue;
            using (Stream input = assembly.GetManifestResourceStream(name))
            {
                if (input == null) throw new InvalidOperationException("The installer payload is missing: " + suffix);
                using (FileStream output = File.Create(path)) input.CopyTo(output);
            }
            return path;
        }
        throw new InvalidOperationException("The installer payload is missing: " + suffix);
    }

    private static string HashResource(string suffix)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        foreach (string name in assembly.GetManifestResourceNames())
        {
            if (!name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) continue;
            using (Stream input = assembly.GetManifestResourceStream(name))
            using (SHA256 sha = SHA256.Create())
            {
                if (input == null) throw new InvalidOperationException("The installer payload is missing: " + suffix);
                return ToHex(sha.ComputeHash(input));
            }
        }
        throw new InvalidOperationException("The installer payload is missing: " + suffix);
    }

    private static string HashFile(string path)
    {
        using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (SHA256 sha = SHA256.Create()) return ToHex(sha.ComputeHash(input));
    }

    private static string ToHex(byte[] bytes)
    {
        return BitConverter.ToString(bytes).Replace("-", String.Empty);
    }

    private static bool FileMatchesHash(string path, string expectedHash)
    {
        if (!File.Exists(path)) return false;
        try { return String.Equals(HashFileShared(path), expectedHash, StringComparison.OrdinalIgnoreCase); }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private static string HashFileShared(string path)
    {
        using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (SHA256 sha = SHA256.Create()) return ToHex(sha.ComputeHash(input));
    }

    private static Label MakeLabel(string text, float size, FontStyle style, Color color)
    {
        return new Label {
            Text = text,
            Font = new Font("Segoe UI", size, style, GraphicsUnit.Point),
            ForeColor = color,
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleLeft,
            UseCompatibleTextRendering = true
        };
    }

    private void DragWindow(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left || WindowState == FormWindowState.Maximized) return;
        ReleaseCapture();
        SendMessage(Handle, WmNcLButtonDown, new IntPtr(HtCaption), IntPtr.Zero);
    }

    private void HandleFormClosing(object sender, FormClosingEventArgs e)
    {
        if (!_busy) return;
        e.Cancel = true;
        SetStatus("Setup is still running", "Please wait for the current operation to finish before closing this window.", Color.FromArgb(247, 194, 105));
    }
}

internal sealed class DiscordTarget
{
    internal readonly string DisplayName;
    internal readonly string Branch;
    internal readonly string Location;
    internal readonly bool IsCustom;
    internal readonly string Name;

    internal DiscordTarget(string displayName, string branch, string location, bool isCustom)
    {
        DisplayName = displayName;
        Branch = branch;
        Location = location;
        IsCustom = isCustom;
        if (isCustom)
            Name = "custom Discord install";
        else if (branch == "stable")
            Name = "Discord Stable";
        else if (branch == "ptb")
            Name = "Discord PTB";
        else if (branch == "canary")
            Name = "Discord Canary";
        else if (branch == "development")
            Name = "Discord Development";
        else
            Name = "Discord install";
    }

    public override string ToString()
    {
        return DisplayName;
    }
}

internal sealed class DiscordTargetCard : Panel
{
    private readonly Color _surface;
    private readonly Color _accent;
    private readonly Color _muted;
    private readonly PictureBox _icon;
    private readonly Label _name;
    private readonly Label _location;
    private bool _selected;
    private bool _hovered;

    internal DiscordTarget Target { get; private set; }
    internal bool Available { get; private set; }
    internal event EventHandler TargetSelected;

    internal DiscordTargetCard(string title, Color surface, Color accent, Color muted)
    {
        _surface = surface;
        _accent = accent;
        _muted = muted;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        BackColor = surface;
        Cursor = Cursors.Arrow;

        _icon = new PictureBox();
        _icon.Location = new Point(12, 18);
        _icon.Size = new Size(34, 34);
        _icon.SizeMode = PictureBoxSizeMode.Zoom;
        _icon.BackColor = Color.Transparent;
        Controls.Add(_icon);

        _name = new Label();
        _name.Text = title;
        _name.Location = new Point(56, 12);
        _name.Size = new Size(122, 22);
        _name.Font = new Font("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point);
        _name.ForeColor = Color.FromArgb(224, 228, 238);
        _name.BackColor = Color.Transparent;
        _name.AutoEllipsis = true;
        Controls.Add(_name);

        _location = new Label();
        _location.Location = new Point(57, 36);
        _location.Size = new Size(122, 18);
        _location.Font = new Font("Segoe UI", 7.4F, FontStyle.Regular, GraphicsUnit.Point);
        _location.ForeColor = muted;
        _location.BackColor = Color.Transparent;
        _location.AutoEllipsis = true;
        Controls.Add(_location);

        WireInteraction(_icon);
        WireInteraction(_name);
        WireInteraction(_location);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (_name == null || _location == null) return;
        int textWidth = Math.Max(72, Width - 68);
        _name.Width = textWidth;
        _location.Width = textWidth;
    }

    internal bool Selected
    {
        get { return _selected; }
        set { if (_selected == value) return; _selected = value; Invalidate(); }
    }

    internal void SetTarget(DiscordTarget target, bool available, Image image)
    {
        Target = target;
        Available = available;
        _location.Text = available
            ? "Installed · " + Path.GetFileName(target.Location)
            : "Not installed";
        _location.ForeColor = available ? Color.FromArgb(120, 222, 193) : _muted;
        _name.ForeColor = available ? Color.FromArgb(224, 228, 238) : Color.FromArgb(128, 139, 158);
        Cursor = available ? Cursors.Hand : Cursors.Arrow;
        Enabled = available;

        Image previous = _icon.Image;
        _icon.Image = image;
        if (previous != null) previous.Dispose();
        Invalidate();
    }

    protected override void OnClick(EventArgs e)
    {
        base.OnClick(e);
        RaiseTargetSelected();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        Color fill = !Available ? Color.FromArgb(22, 24, 32) : (_selected ? Color.FromArgb(38, 42, 62) : (_hovered ? Color.FromArgb(32, 35, 47) : _surface));
        using (GraphicsPath path = RoundedRectangle(bounds, 12))
        using (SolidBrush brush = new SolidBrush(fill))
            e.Graphics.FillPath(brush, path);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        Color border = _selected ? _accent : (_hovered && Available ? Color.FromArgb(76, 82, 111) : Color.FromArgb(49, 53, 68));
        using (GraphicsPath path = RoundedRectangle(bounds, 12))
        using (Pen pen = new Pen(border, _selected ? 1.5F : 1F))
            e.Graphics.DrawPath(pen, path);
        if (_selected)
        {
            using (SolidBrush brush = new SolidBrush(_accent))
                e.Graphics.FillEllipse(brush, Width - 19, 9, 6, 6);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && _icon != null && _icon.Image != null)
        {
            Image image = _icon.Image;
            _icon.Image = null;
            image.Dispose();
        }
        base.Dispose(disposing);
    }

    private void WireInteraction(Control control)
    {
        control.Click += delegate { RaiseTargetSelected(); };
        control.MouseEnter += delegate { _hovered = Available; Invalidate(); };
        control.MouseLeave += delegate { _hovered = false; Invalidate(); };
    }

    private void RaiseTargetSelected()
    {
        if (!Available || TargetSelected == null) return;
        TargetSelected(this, EventArgs.Empty);
    }

    internal static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class RoundedSurfacePanel : Panel
{
    private readonly Color _surface;
    private readonly Color _border;
    private readonly int _radius;

    internal RoundedSurfacePanel(Color surface, Color border, int radius)
    {
        _surface = surface;
        _border = border;
        _radius = radius;
        BackColor = surface;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (ClientRectangle.Width <= 1 || ClientRectangle.Height <= 1) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath path = DiscordTargetCard.RoundedRectangle(bounds, _radius))
        using (SolidBrush brush = new SolidBrush(_surface))
            e.Graphics.FillPath(brush, path);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath path = DiscordTargetCard.RoundedRectangle(bounds, _radius))
        using (Pen pen = new Pen(_border))
            e.Graphics.DrawPath(pen, path);
    }
}

internal sealed class LogoMark : Control
{
    internal LogoMark()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor | ControlStyles.UserPaint, true);
        BackColor = Color.Transparent;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle bounds = new Rectangle(1, 1, Width - 3, Height - 3);
        using (GraphicsPath path = RoundedRectangle(bounds, Math.Max(8, Width / 5)))
        using (LinearGradientBrush brush = new LinearGradientBrush(bounds,
            Color.FromArgb(140, 154, 255), Color.FromArgb(117, 113, 232), 30F))
            e.Graphics.FillPath(brush, path);

        using (Font font = new Font("Segoe UI", Width > 50 ? 20F : 10F, FontStyle.Bold, GraphicsUnit.Point))
        using (SolidBrush textBrush = new SolidBrush(Color.FromArgb(11, 19, 30)))
        using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            e.Graphics.DrawString("971", font, textBrush, bounds, format);
    }

    private static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal enum ButtonStyle
{
    Primary,
    Secondary,
    Danger
}

internal sealed class ActionButton : Button
{
    private readonly ButtonStyle _style;
    private bool _hovered;

    internal ActionButton(string text, ButtonStyle style)
    {
        Text = text;
        _style = style;
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        Font = new Font("Segoe UI", 8.5F,
            style == ButtonStyle.Primary ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Point);
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hovered = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hovered = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        Color fill;
        Color textColor = Color.FromArgb(224, 228, 238);

        if (!Enabled)
        {
            fill = Color.FromArgb(37, 39, 50);
            textColor = Color.FromArgb(111, 122, 140);
        }
        else if (_style == ButtonStyle.Primary)
        {
            fill = _hovered ? Color.FromArgb(158, 169, 255) : Color.FromArgb(126, 141, 245);
            textColor = Color.FromArgb(16, 18, 27);
        }
        else if (_style == ButtonStyle.Secondary)
            fill = _hovered ? Color.FromArgb(54, 58, 75) : Color.FromArgb(39, 42, 55);
        else if (_style == ButtonStyle.Danger)
        {
            fill = _hovered ? Color.FromArgb(76, 44, 57) : Color.FromArgb(50, 34, 45);
            textColor = Color.FromArgb(237, 162, 174);
        }
        else
            fill = Color.FromArgb(39, 42, 55);

        using (GraphicsPath path = RoundedRectangle(bounds, 10))
        using (SolidBrush brush = new SolidBrush(fill))
            e.Graphics.FillPath(brush, path);

        TextRenderer.DrawText(e.Graphics, Text, Font, bounds, textColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }

    private static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal enum WindowControlKind
{
    Close,
    Minimize,
    Zoom
}

internal sealed class WindowControlButton : Control
{
    private readonly WindowControlKind _kind;
    private bool _hovered;

    internal WindowControlButton(WindowControlKind kind)
    {
        _kind = kind;
        Size = new Size(14, 14);
        Cursor = Cursors.Hand;
        AccessibleRole = AccessibleRole.PushButton;
        AccessibleName = kind == WindowControlKind.Close ? "Close" : kind == WindowControlKind.Minimize ? "Minimize" : "Maximize or restore";
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor | ControlStyles.UserPaint, true);
        BackColor = Color.Transparent;
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hovered = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hovered = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Color color = _kind == WindowControlKind.Close ? Color.FromArgb(245, 96, 86) : _kind == WindowControlKind.Minimize ? Color.FromArgb(239, 185, 66) : Color.FromArgb(49, 194, 99);
        using (SolidBrush brush = new SolidBrush(color))
            e.Graphics.FillEllipse(brush, 0, 0, Width - 1, Height - 1);

        if (!_hovered) return;
        using (Pen pen = new Pen(Color.FromArgb(76, 35, 35), 1.2F))
        {
            if (_kind == WindowControlKind.Close)
            {
                e.Graphics.DrawLine(pen, 4, 4, 9, 9);
                e.Graphics.DrawLine(pen, 9, 4, 4, 9);
            }
            else if (_kind == WindowControlKind.Minimize)
                e.Graphics.DrawLine(pen, 4, 7, 9, 7);
            else
            {
                e.Graphics.DrawLine(pen, 4, 9, 4, 5);
                e.Graphics.DrawLine(pen, 4, 5, 8, 5);
                e.Graphics.DrawLine(pen, 9, 4, 9, 8);
                e.Graphics.DrawLine(pen, 9, 8, 5, 8);
            }
        }
    }
}
