require('dotenv').config(); // ADD THIS LINE AT THE VERY TOP
const fs = require('fs');

const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000; // CHANGED: Use environment variable

const activeConnections = new Map();

const sessionParser = session({
  secret: process.env.SESSION_SECRET, // CHANGED: Use environment variable
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
});

// Apply middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(sessionParser);

// Build DB connection config from environment variables so credentials are configurable.
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'texting',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
  ssl: {
        rejectUnauthorized: false
    }
};

const db = mysql.createConnection(dbConfig);

db.connect(err => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
  console.log('Connected to MySQL database');
});

wss.on('connection', (ws, request) => {
  sessionParser(request, {}, () => {
    const userId = request.session.userId;
    if (!userId) {
      ws.close();
      return;
    }

    activeConnections.set(userId, ws);
    console.log(`User ${userId} connected via WebSocket`);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'typing') {
          db.query('SELECT username FROM users WHERE id = ?', [userId], (err, results) => {
            if (!err && results.length > 0) {
              notifyConversation(data.conversation_id, {
                type: 'user_typing',
                conversation_id: data.conversation_id,
                user_id: userId,
                username: results[0].username
              });
            }
          });
        } else if (data.type === 'stopped_typing') {
          notifyConversation(data.conversation_id, {
            type: 'user_stopped_typing',
            conversation_id: data.conversation_id,
            user_id: userId
          });
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      activeConnections.delete(userId);
      console.log(`User ${userId} disconnected`);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
});

function notifyConversation(conversationId, data) {
  db.query(
    'SELECT user1_id, user2_id FROM conversations WHERE id = ?',
    [conversationId],
    (err, results) => {
      if (err || results.length === 0) return;
      const { user1_id, user2_id } = results[0];
      [user1_id, user2_id].forEach(userId => {
        const ws = activeConnections.get(userId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      });
    }
  );
}


function notifyGroup(groupId, data) {
  db.query(
    'SELECT user_id FROM group_members WHERE group_id = ?',
    [groupId],
    (err, results) => {
      if (err || results.length === 0) return;
      
      results.forEach(row => {
        const ws = activeConnections.get(row.user_id);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      });
    }
  );
}

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.post('/api/signup', async (req, res) => {
  const { username, password, pfp_url } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing username or password' });

  const hash = await bcrypt.hash(password, 10);

  db.query(
    'INSERT INTO users (username, password_hash, pfp_url) VALUES (?, ?, ?)',
    [username, hash, pfp_url || 'https://www.computerhope.com/issues/pictures/default.png'],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: 'Username already exists' });
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      req.session.userId = result.insertId;
      req.session.username = username;
      res.json({ success: true, user_id: result.insertId });
    }
  );
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
    if (err || results.length === 0) return res.send('Invalid username or password');
    const user = results[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.send('Invalid username or password');

    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => { res.redirect('/login'); });
});

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/user-info', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  db.query('SELECT username, pfp_url FROM users WHERE id = ?', [req.session.userId], (err, results) => {
    if (err || results.length === 0) return res.status(500).send('User not found');
    const user = results[0];
    res.json({ id: req.session.userId, username: user.username, pfp_url: user.pfp_url || 'https://www.computerhope.com/issues/pictures/default.png' });
  });
});

app.post('/create-private-chat', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { recipient_username } = req.body;

  db.query('SELECT id FROM users WHERE username = ?', [recipient_username], (err, results) => {
    if (err) return res.status(500).send('Database error');
    if (results.length === 0) return res.send('User not found');

    const recipient_id = results[0].id;
    const user1_id = Math.min(req.session.userId, recipient_id);
    const user2_id = Math.max(req.session.userId, recipient_id);

    db.query('SELECT id FROM conversations WHERE user1_id = ? AND user2_id = ?', [user1_id, user2_id], (err, results2) => {
      if (err) return res.status(500).send('Database error');
      if (results2.length > 0) return res.redirect(`/chat/${results2[0].id}`);

      db.query('INSERT INTO conversations (user1_id, user2_id) VALUES (?, ?)', [user1_id, user2_id], (err, result) => {
        if (err) return res.status(500).send('Database error');
        res.redirect(`/chat/${result.insertId}`);
      });
    });
  });
});

app.get('/api/private-chats', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');

  db.query(`
    SELECT c.id,
           CASE WHEN c.user1_id = ? THEN u2.username ELSE u1.username END as username,
           CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as other_user_id
    FROM conversations c
    JOIN users u1 ON c.user1_id = u1.id
    JOIN users u2 ON c.user2_id = u2.id
    WHERE c.user1_id = ? OR c.user2_id = ?
    ORDER BY c.created_at DESC
  `, [req.session.userId, req.session.userId, req.session.userId, req.session.userId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    res.json(results);
  });
});

app.get('/api/messages/:conversationId', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { conversationId } = req.params;
  const limit = req.query.limit || 100;

  db.query(`
    SELECT dm.id, dm.message, dm.sender_id, u.username, u.pfp_url, dm.created_at, dm.edited_at, dm.deleted,
      dm.reply_to_message_id,
      (SELECT message FROM direct_messages WHERE id = dm.reply_to_message_id) AS reply_to_message,
      (SELECT u2.username FROM users u2 JOIN direct_messages dm2 ON u2.id = dm2.sender_id WHERE dm2.id = dm.reply_to_message_id) AS reply_to_username
    FROM direct_messages dm
    JOIN users u ON dm.sender_id = u.id
    WHERE dm.conversation_id = ?
    ORDER BY dm.created_at DESC
    LIMIT ?
  `, [conversationId, parseInt(limit)], (err, results) => {
    if (err) return res.status(500).send('Database error');
    res.json(results.reverse());
  });
});

app.post('/api/send-message', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { conversation_id, message } = req.body;
  if (!message || message.trim() === '') return res.status(400).send('Message is required');

  db.query(
    'INSERT INTO direct_messages (conversation_id, sender_id, message) VALUES (?, ?, ?)',
    [conversation_id, req.session.userId, message],
    (err, result) => {
      if (err) return res.status(500).send('Database error');
      
      db.query(`
        SELECT dm.id, dm.message, dm.sender_id, u.username, u.pfp_url, dm.created_at, dm.edited_at, dm.deleted
        FROM direct_messages dm
        JOIN users u ON dm.sender_id = u.id
        WHERE dm.id = ?
      `, [result.insertId], (err2, msgResults) => {
        if (!err2 && msgResults.length > 0) {
          notifyConversation(conversation_id, {
            type: 'new_message',
            conversation_id,
            message: msgResults[0]
          });
        }
      });
      
      res.json({ success: true, id: result.insertId });
    }
  );
});

app.post('/api/reply-message', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { conversation_id, message, reply_to_message_id } = req.body;
  if (!message || message.trim() === '') return res.status(400).send('Message required');

  db.query(
    'INSERT INTO direct_messages (conversation_id, sender_id, message, reply_to_message_id) VALUES (?, ?, ?, ?)',
    [conversation_id, req.session.userId, message, reply_to_message_id],
    (err, result) => {
      if (err) return res.status(500).send('Database error');
      
      notifyConversation(conversation_id, {
        type: 'reload_messages',
        conversation_id
      });
      
      res.json({ success: true, id: result.insertId });
    }
  );
});

app.put('/api/edit-message/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const messageId = req.params.id;
  const { message } = req.body;
  if (!message || message.trim() === '') return res.status(400).send('Message is required');

  db.query('SELECT sender_id, deleted, conversation_id FROM direct_messages WHERE id = ?', [messageId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    if (results.length === 0 || results[0].sender_id !== req.session.userId) return res.status(403).send('Forbidden');
    if (results[0].deleted) return res.status(400).send('Cannot edit deleted message');

    const conversationId = results[0].conversation_id;

    db.query('UPDATE direct_messages SET message = ?, edited_at = NOW() WHERE id = ?', [message, messageId], (err2) => {
      if (err2) return res.status(500).send('Database error');
      
      notifyConversation(conversationId, {
        type: 'message_edited',
        conversation_id: conversationId,
        message_id: messageId
      });
      
      res.json({ success: true });
    });
  });
});

app.put('/api/update-pfp', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { pfp_url } = req.body;
  db.query('UPDATE users SET pfp_url = ? WHERE id = ?', [pfp_url, req.session.userId], (err) => {
    if (err) return res.status(500).send('Database error');
    res.json({ success: true });
  });
});

app.delete('/api/delete-message/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const messageId = req.params.id;

  db.query('SELECT sender_id, conversation_id FROM direct_messages WHERE id = ?', [messageId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    if (results.length === 0 || results[0].sender_id !== req.session.userId) return res.status(403).send('Forbidden');

    const conversationId = results[0].conversation_id;

    db.query('UPDATE direct_messages SET deleted = 1 WHERE id = ?', [messageId], (err2) => {
      if (err2) return res.status(500).send('Database error');
      
      notifyConversation(conversationId, {
        type: 'message_deleted',
        conversation_id: conversationId,
        message_id: messageId
      });
      
      res.json({ success: true });
    });
  });
});

app.delete('/api/delete-conversation/:conversationId', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { conversationId } = req.params;

  db.query(
    'SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
    [conversationId, req.session.userId, req.session.userId],
    (err, results) => {
      if (err) return res.status(500).send('Database error');
      if (results.length === 0) return res.status(403).send('Forbidden');

      db.query('DELETE FROM direct_messages WHERE conversation_id = ?', [conversationId], (err2) => {
        if (err2) return res.status(500).send('Database error');

        db.query('DELETE FROM conversations WHERE id = ?', [conversationId], (err3) => {
          if (err3) return res.status(500).send('Database error');
          
          notifyConversation(conversationId, {
            type: 'conversation_deleted',
            conversation_id: conversationId
          });
          
          res.json({ success: true });
        });
      });
    }
  );
});

app.post('/api/create-group', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { name, description, members } = req.body;
  
  if (!name || !name.trim()) return res.status(400).send('Group name required');
  
  db.query(
    'INSERT INTO group_chats (name, description, created_by) VALUES (?, ?, ?)',
    [name, description || '', req.session.userId],
    (err, result) => {
      if (err) return res.status(500).send('Database error');
      
      const groupId = result.insertId;
      
      db.query(
        'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
        [groupId, req.session.userId],
        (err2) => {
          if (err2) {
            console.error('Error adding creator to group:', err2);
            return res.status(500).send('Database error');
          }
          
          if (members && members.length > 0) {
            const placeholders = members.map(() => '?').join(',');
            db.query(
              `SELECT id FROM users WHERE username IN (${placeholders})`,
              members,
              (err3, userResults) => {
                if (!err3 && userResults.length > 0) {
                  const values = userResults.map(u => [groupId, u.id]);
                  db.query(
                    'INSERT INTO group_members (group_id, user_id) VALUES ?',
                    [values],
                    (err4) => {
                      if (err4) console.error('Error adding members:', err4);
                    }
                  );
                }
              }
            );
          }
          
          res.json({ success: true, group_id: groupId });
        }
      );
    }
  );
});

app.get('/api/group-chats', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  
  db.query(`
    SELECT gc.id, gc.name, gc.description, gc.created_by,
           (SELECT COUNT(*) FROM group_members WHERE group_id = gc.id) as member_count
    FROM group_chats gc
    JOIN group_members gm ON gc.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY gc.created_at DESC
  `, [req.session.userId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    res.json(results);
  });
});

app.get('/api/group-messages/:groupId', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { groupId } = req.params;
  const limit = req.query.limit || 100;
  
  db.query(
    'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, req.session.userId],
    (err, memberCheck) => {
      if (err || memberCheck.length === 0) return res.status(403).send('Not a member');
      
      db.query(`
        SELECT gm.id, gm.message, gm.sender_id, u.username, u.pfp_url, 
               gm.created_at, gm.edited_at, gm.deleted, gm.reply_to_message_id,
               (SELECT message FROM group_messages WHERE id = gm.reply_to_message_id) AS reply_to_message,
               (SELECT u2.username FROM users u2 JOIN group_messages gm2 ON u2.id = gm2.sender_id WHERE gm2.id = gm.reply_to_message_id) AS reply_to_username
        FROM group_messages gm
        JOIN users u ON gm.sender_id = u.id
        WHERE gm.group_id = ?
        ORDER BY gm.created_at DESC
        LIMIT ?
      `, [groupId, parseInt(limit)], (err2, results) => {
        if (err2) return res.status(500).send('Database error');
        res.json(results.reverse());
      });
    }
  );
});

app.post('/api/send-group-message', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { group_id, message, reply_to_message_id } = req.body;
  if (!message || message.trim() === '') return res.status(400).send('Message required');
  
  db.query(
    'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
    [group_id, req.session.userId],
    (err, memberCheck) => {
      if (err || memberCheck.length === 0) return res.status(403).send('Not a member');
      
      db.query(
        'INSERT INTO group_messages (group_id, sender_id, message, reply_to_message_id) VALUES (?, ?, ?, ?)',
        [group_id, req.session.userId, message, reply_to_message_id || null],
        (err2, result) => {
          if (err2) return res.status(500).send('Database error');
          
          notifyGroup(group_id, {
            type: 'new_group_message',
            group_id: group_id
          });
          
          res.json({ success: true, id: result.insertId });
        }
      );
    }
  );
});

app.put('/api/edit-group-message/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const messageId = req.params.id;
  const { message } = req.body;
  if (!message || message.trim() === '') return res.status(400).send('Message required');
  
  db.query('SELECT sender_id, deleted, group_id FROM group_messages WHERE id = ?', [messageId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    if (results.length === 0 || results[0].sender_id !== req.session.userId) return res.status(403).send('Forbidden');
    if (results[0].deleted) return res.status(400).send('Cannot edit deleted message');
    
    const groupId = results[0].group_id;
    
    db.query('UPDATE group_messages SET message = ?, edited_at = NOW() WHERE id = ?', [message, messageId], (err2) => {
      if (err2) return res.status(500).send('Database error');
      
      notifyGroup(groupId, {
        type: 'group_message_edited',
        group_id: groupId,
        message_id: messageId
      });
      
      res.json({ success: true });
    });
  });
});

app.delete('/api/delete-group-message/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const messageId = req.params.id;
  
  db.query('SELECT sender_id, group_id FROM group_messages WHERE id = ?', [messageId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    if (results.length === 0 || results[0].sender_id !== req.session.userId) return res.status(403).send('Forbidden');
    
    const groupId = results[0].group_id;
    
    db.query('UPDATE group_messages SET deleted = 1 WHERE id = ?', [messageId], (err2) => {
      if (err2) return res.status(500).send('Database error');
      
      notifyGroup(groupId, {
        type: 'group_message_deleted',
        group_id: groupId,
        message_id: messageId
      });
      
      res.json({ success: true });
    });
  });
});

app.put('/api/update-group/:groupId', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { groupId } = req.params;
  const { name, description } = req.body;
  
  db.query(
    'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, req.session.userId],
    (err, memberCheck) => {
      if (err || memberCheck.length === 0) return res.status(403).send('Not a member');
      
      const updates = [];
      const values = [];
      
      if (name) {
        updates.push('name = ?');
        values.push(name);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
      }
      
      if (updates.length === 0) return res.status(400).send('Nothing to update');
      
      values.push(groupId);
      
      db.query(
        `UPDATE group_chats SET ${updates.join(', ')} WHERE id = ?`,
        values,
        (err2) => {
          if (err2) return res.status(500).send('Database error');
          
          notifyGroup(groupId, {
            type: 'group_updated',
            group_id: groupId
          });
          
          res.json({ success: true });
        }
      );
    }
  );
});

app.get('/api/group-members/:groupId', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { groupId } = req.params;
  
  db.query(`
    SELECT u.id, u.username, u.pfp_url, gm.joined_at
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = ?
    ORDER BY gm.joined_at ASC
  `, [groupId], (err, results) => {
    if (err) return res.status(500).send('Database error');
    res.json(results);
  });
});

app.post('/api/add-group-member', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { group_id, username } = req.body;
  
  db.query(
    'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
    [group_id, req.session.userId],
    (err, memberCheck) => {
      if (err || memberCheck.length === 0) return res.status(403).send('Not a member');
      
      db.query('SELECT id FROM users WHERE username = ?', [username], (err2, userResults) => {
        if (err2) return res.status(500).send('Database error');
        if (userResults.length === 0) return res.status(404).send('User not found');
        
        const newUserId = userResults[0].id;
        
        db.query(
          'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
          [group_id, newUserId],
          (err3) => {
            if (err3) {
              if (err3.code === 'ER_DUP_ENTRY') return res.status(400).send('Already a member');
              return res.status(500).send('Database error');
            }
            
            notifyGroup(group_id, {
              type: 'member_added',
              group_id: group_id
            });
            
            res.json({ success: true });
          }
        );
      });
    }
  );
});

app.post('/api/leave-group/:groupId', (req, res) => {
  if (!req.session.userId) return res.status(401).send('Not logged in');
  const { groupId } = req.params;
  
  db.query(
    'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, req.session.userId],
    (err) => {
      if (err) return res.status(500).send('Database error');
      
      db.query(
        'SELECT COUNT(*) as count FROM group_members WHERE group_id = ?',
        [groupId],
        (err2, results) => {
          if (!err2 && results[0].count === 0) {
            db.query('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
            db.query('DELETE FROM group_chats WHERE id = ?', [groupId]);
          }
        }
      );
      
      notifyGroup(groupId, {
        type: 'member_left',
        group_id: groupId
      });
      
      res.json({ success: true });
    }
  );
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/chat/:id', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});