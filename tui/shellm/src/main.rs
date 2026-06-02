use std::{env, io, mem, process::Stdio, time::Duration};

use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers, MouseEventKind, EnableMouseCapture, DisableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, Wrap},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::mpsc,
};

struct Message {
    sender: String,
    content: String,
    is_agent: bool,
}

struct App {
    messages: Vec<Message>,
    input: String,
    cursor: usize,
    identity_name: String,
    from: Option<String>,
    scroll_offset: usize,
    kill_ring: String,
    history: Vec<String>,
    history_idx: Option<usize>,
    stashed_input: String,
}

fn byte_pos(s: &str, char_idx: usize) -> usize {
    s.char_indices().nth(char_idx).map_or(s.len(), |(i, _)| i)
}

/// Calculate display (col, row) for a cursor position in wrapped text.
fn cursor_xy(input: &str, cursor: usize, width: usize) -> (u16, u16) {
    if width == 0 {
        return (0, 0);
    }
    let mut col = 0usize;
    let mut row = 0usize;
    for (i, ch) in input.chars().enumerate() {
        if i == cursor {
            break;
        }
        if ch == '\n' {
            row += 1;
            col = 0;
        } else {
            col += 1;
            if col >= width {
                col = 0;
                row += 1;
            }
        }
    }
    (col as u16, row as u16)
}

/// Character-wrap input into display lines (matches cursor_xy behavior exactly).
fn wrap_input(input: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![input.to_string()];
    }
    let mut lines = Vec::new();
    for line in input.split('\n') {
        let chars: Vec<char> = line.chars().collect();
        if chars.is_empty() {
            lines.push(String::new());
        } else {
            for chunk in chars.chunks(width) {
                lines.push(chunk.iter().collect());
            }
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let identity_name = env::var("IDENTITY_NAME").unwrap_or_else(|_| "agent".into());

    let mut from: Option<String> = None;
    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--from" {
            i += 1;
            from = args.get(i).cloned();
        }
        i += 1;
    }

    enable_raw_mode()?;
    execute!(io::stdout(), EnterAlternateScreen, EnableMouseCapture)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;

    let result = run(&mut terminal, identity_name, from).await;

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), DisableMouseCapture, LeaveAlternateScreen)?;

    result
}

async fn run(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    identity_name: String,
    from: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    let id_name = identity_name.clone();
    let parse_and_send = |line: &str, tx: &mpsc::UnboundedSender<Message>, id: &str| {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };
        let step_type = json["type"].as_str().unwrap_or("");
        let content = json["content"].as_str().unwrap_or("").to_string();
        if content.is_empty() {
            return;
        }
        let (sender, is_agent) = match step_type {
            "human-msg" => (json["from"].as_str().unwrap_or("you").to_string(), false),
            "agent-msg" => (id.to_string(), true),
            _ => return,
        };
        let _ = tx.send(Message {
            sender,
            content,
            is_agent,
        });
    };

    // Phase 1: load recent history via `traj cat --filter | tail -n 20`
    let id_hist = id_name.clone();
    let tx_hist = tx.clone();
    let history_loader = tokio::spawn(async move {
        let Ok(output) = tokio::process::Command::new("bash")
            .args(["-c", "traj cat --filter type=human-msg,agent-msg --raw 2>/dev/null | tail -n 20"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
        else {
            return;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            parse_and_send(line, &tx_hist, &id_hist);
        }
    });

    // Wait for history to load before starting the follow watcher
    let _ = history_loader.await;

    // Phase 2: follow new messages via `traj tail -f -n 0`
    let watcher = tokio::spawn(async move {
        let Ok(mut child) = tokio::process::Command::new("traj")
            .args(["tail", "-f", "--filter", "type=human-msg,agent-msg", "-n", "0", "--raw"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return;
        };

        let Some(stdout) = child.stdout.take() else { return };
        let mut lines = BufReader::new(stdout).lines();

        while let Ok(Some(line)) = lines.next_line().await {
            parse_and_send(&line, &tx, &id_name);
        }
    });

    let mut app = App {
        messages: Vec::new(),
        input: String::new(),
        cursor: 0,
        identity_name,
        from,
        scroll_offset: 0,
        kill_ring: String::new(),
        history: Vec::new(),
        history_idx: None,
        stashed_input: String::new(),
    };

    loop {
        while let Ok(msg) = rx.try_recv() {
            app.messages.push(msg);
            app.scroll_offset = 0;
        }

        terminal.draw(|f| draw(f, &app))?;

        if event::poll(Duration::from_millis(50))? {
            let ev = event::read()?;
            if let Event::Mouse(mouse) = &ev {
                match mouse.kind {
                    MouseEventKind::ScrollUp => app.scroll_offset += 3,
                    MouseEventKind::ScrollDown => {
                        app.scroll_offset = app.scroll_offset.saturating_sub(3);
                    }
                    _ => {}
                }
            }
            if let Event::Key(key) = ev {
                match key.code {
                    KeyCode::Char('c') | KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => break,
                    KeyCode::Esc => break,
                    KeyCode::Enter if key.modifiers.contains(KeyModifiers::SHIFT) => {
                        let pos = byte_pos(&app.input, app.cursor);
                        app.input.insert(pos, '\n');
                        app.cursor += 1;
                    }
                    KeyCode::Enter => {
                        if !app.input.is_empty() {
                            let msg = mem::take(&mut app.input);
                            app.cursor = 0;
                            app.scroll_offset = 0;
                            app.history_idx = None;
                            app.history.push(msg.clone());
                            let from = app.from.clone();
                            tokio::spawn(async move {
                                let mut cmd = tokio::process::Command::new("chat");
                                cmd.arg("send");
                                if let Some(ref f) = from {
                                    cmd.args(["--from", f]);
                                }
                                cmd.arg(&msg)
                                    .stdout(Stdio::null())
                                    .stderr(Stdio::null());
                                let _ = cmd.status().await;
                            });
                        }
                    }
                    KeyCode::Char('a') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        app.cursor = 0;
                    }
                    KeyCode::Char('e') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        app.cursor = app.input.chars().count();
                    }
                    KeyCode::Char('b') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        app.cursor = app.cursor.saturating_sub(1);
                    }
                    KeyCode::Char('f') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let len = app.input.chars().count();
                        if app.cursor < len {
                            app.cursor += 1;
                        }
                    }
                    KeyCode::Char('k') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let pos = byte_pos(&app.input, app.cursor);
                        app.kill_ring = app.input[pos..].to_string();
                        app.input.truncate(pos);
                    }
                    KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let pos = byte_pos(&app.input, app.cursor);
                        app.kill_ring = app.input[..pos].to_string();
                        app.input.drain(..pos);
                        app.cursor = 0;
                    }
                    KeyCode::Char('w') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        if app.cursor > 0 {
                            let s: Vec<char> = app.input.chars().collect();
                            let mut i = app.cursor;
                            while i > 0 && s[i - 1] == ' ' {
                                i -= 1;
                            }
                            while i > 0 && s[i - 1] != ' ' {
                                i -= 1;
                            }
                            let from = byte_pos(&app.input, i);
                            let to = byte_pos(&app.input, app.cursor);
                            app.kill_ring = app.input[from..to].to_string();
                            app.input.drain(from..to);
                            app.cursor = i;
                        }
                    }
                    KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let inner_w = terminal.size().map_or(78, |s| s.width.saturating_sub(2)) as usize;
                        let (cx, cy) = cursor_xy(&app.input, app.cursor, inner_w);
                        if cy > 0 {
                            // Move cursor up one display row
                            app.cursor = char_at_xy(&app.input, cx, cy - 1, inner_w);
                        } else if !app.history.is_empty() {
                            // At top line — cycle history
                            let idx = match app.history_idx {
                                None => {
                                    app.stashed_input = app.input.clone();
                                    app.history.len() - 1
                                }
                                Some(i) if i > 0 => i - 1,
                                Some(i) => i,
                            };
                            app.history_idx = Some(idx);
                            app.input = app.history[idx].clone();
                            app.cursor = app.input.chars().count();
                        }
                    }
                    KeyCode::Char('n') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let inner_w = terminal.size().map_or(78, |s| s.width.saturating_sub(2)) as usize;
                        let (cx, cy) = cursor_xy(&app.input, app.cursor, inner_w);
                        let total = wrap_input(&app.input, inner_w).len() as u16;
                        if cy + 1 < total {
                            // Move cursor down one display row
                            app.cursor = char_at_xy(&app.input, cx, cy + 1, inner_w);
                        } else if let Some(idx) = app.history_idx {
                            // At bottom line — cycle history
                            if idx + 1 < app.history.len() {
                                let next = idx + 1;
                                app.history_idx = Some(next);
                                app.input = app.history[next].clone();
                                app.cursor = app.input.chars().count();
                            } else {
                                app.history_idx = None;
                                app.input = mem::take(&mut app.stashed_input);
                                app.cursor = app.input.chars().count();
                            }
                        }
                    }
                    KeyCode::Char('y') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        if !app.kill_ring.is_empty() {
                            let pos = byte_pos(&app.input, app.cursor);
                            let yanked = app.kill_ring.clone();
                            let char_count = yanked.chars().count();
                            app.input.insert_str(pos, &yanked);
                            app.cursor += char_count;
                        }
                    }
                    KeyCode::Char(c) => {
                        let pos = byte_pos(&app.input, app.cursor);
                        app.input.insert(pos, c);
                        app.cursor += 1;
                    }
                    KeyCode::Backspace => {
                        if app.cursor > 0 {
                            app.cursor -= 1;
                            let pos = byte_pos(&app.input, app.cursor);
                            app.input.remove(pos);
                        }
                    }
                    KeyCode::Left => app.cursor = app.cursor.saturating_sub(1),
                    KeyCode::Right => {
                        let len = app.input.chars().count();
                        if app.cursor < len {
                            app.cursor += 1;
                        }
                    }
                    KeyCode::Up => {
                        // Move cursor up one display row
                        let inner_w = terminal.size().map_or(78, |s| s.width.saturating_sub(2)) as usize;
                        if inner_w > 0 {
                            let (cx, cy) = cursor_xy(&app.input, app.cursor, inner_w);
                            if cy > 0 {
                                // Find char index at (cx, cy-1)
                                app.cursor = char_at_xy(&app.input, cx, cy - 1, inner_w);
                            }
                        }
                    }
                    KeyCode::Down => {
                        let inner_w = terminal.size().map_or(78, |s| s.width.saturating_sub(2)) as usize;
                        if inner_w > 0 {
                            let (cx, cy) = cursor_xy(&app.input, app.cursor, inner_w);
                            let total = wrap_input(&app.input, inner_w).len() as u16;
                            if cy + 1 < total {
                                app.cursor = char_at_xy(&app.input, cx, cy + 1, inner_w);
                            }
                        }
                    }
                    KeyCode::PageUp => app.scroll_offset += 5,
                    KeyCode::PageDown => {
                        app.scroll_offset = app.scroll_offset.saturating_sub(5);
                    }
                    _ => {}
                }
            }
        }
    }

    watcher.abort();
    Ok(())
}

/// Find the char index at a given display (col, row), clamping to line boundaries.
fn char_at_xy(input: &str, target_col: u16, target_row: u16, width: usize) -> usize {
    if width == 0 {
        return 0;
    }
    let mut col = 0usize;
    let mut row = 0usize;
    let target_col = target_col as usize;
    let target_row = target_row as usize;
    let mut last_idx = 0;

    for (i, ch) in input.chars().enumerate() {
        if row == target_row && col == target_col {
            return i;
        }
        if row > target_row {
            return last_idx;
        }
        last_idx = i;
        if ch == '\n' {
            if row == target_row {
                // Target col is past end of this line
                return i;
            }
            row += 1;
            col = 0;
        } else {
            col += 1;
            if col >= width {
                if row == target_row && col == target_col {
                    return i + 1;
                }
                col = 0;
                row += 1;
            }
        }
    }
    // Cursor at end of input
    input.chars().count()
}

fn draw(f: &mut Frame, app: &App) {
    let total_h = f.size().height;
    let inner_w = f.size().width.saturating_sub(2) as usize;

    // Pre-wrap input text (character-based, matches cursor_xy exactly)
    let wrapped = wrap_input(&app.input, inner_w);
    let text_lines = wrapped.len();

    // Input box grows with content, capped at half the screen
    let max_input_h = (total_h / 2).max(3);
    let input_h = ((text_lines as u16) + 2).min(max_input_h).max(3);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(input_h)])
        .split(f.size());

    // Messages area
    let msg_lines: Vec<Line> = app
        .messages
        .iter()
        .map(|m| {
            let color = if m.is_agent {
                Color::Green
            } else {
                Color::Blue
            };
            Line::from(vec![
                Span::styled(format!("{}: ", m.sender), Style::default().fg(color).bold()),
                Span::raw(&m.content),
            ])
        })
        .collect();

    let para = Paragraph::new(msg_lines).wrap(Wrap { trim: false });
    let msg_inner_w = chunks[0].width.saturating_sub(2);
    let msg_inner_h = chunks[0].height.saturating_sub(2) as usize;
    let total = para.line_count(msg_inner_w);
    let max_scroll = total.saturating_sub(msg_inner_h);
    let scroll = max_scroll.saturating_sub(app.scroll_offset) as u16;

    let messages = para
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(format!(" {} ", app.identity_name)),
        )
        .scroll((scroll, 0));
    f.render_widget(messages, chunks[0]);

    // Input area — render pre-wrapped lines (no ratatui Wrap, so cursor matches exactly)
    let (cx, cy) = cursor_xy(&app.input, app.cursor, inner_w);
    let visible_lines = input_h.saturating_sub(2);
    let input_scroll = if cy >= visible_lines {
        cy - visible_lines + 1
    } else {
        0
    };

    let input_text: Vec<Line> = wrapped.iter().map(|l| Line::from(l.as_str())).collect();
    let input = Paragraph::new(input_text)
        .block(Block::default().borders(Borders::ALL).title(" > "))
        .scroll((input_scroll, 0));
    f.render_widget(input, chunks[1]);

    f.set_cursor(
        chunks[1].x + 1 + cx,
        chunks[1].y + 1 + cy - input_scroll,
    );
}
