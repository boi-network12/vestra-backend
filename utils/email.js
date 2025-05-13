const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USERNAME || 'kamdilichukwu6@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'gtup tobq znth kaei',
  },
});

transporter.verify((error) => {
  if (error) {
    console.error('Email server connection error:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Helper function to compile template
const compileTemplate = (templateName, context) => {
  const filePath = path.join(__dirname, 'emailTemplates', `${templateName}.handlebars`);
  const source = fs.readFileSync(filePath, 'utf8');
  const template = handlebars.compile(source);
  return template(context);
};

// Send verification email
exports.sendVerificationEmail = async (email, name, code) => {
  try {
    const html = compileTemplate('verification', {
      name,
      code,
      year: new Date().getFullYear(),
    });

    const mailOptions = {
      from: `"Vestra" <${process.env.EMAIL_USERNAME}>`,
      to: email,
      subject: 'Verify Your Email Address',
      html,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Verification email sent to ${email}`);
  } catch (error) {
    console.error(`Error sending verification email to ${email}:`, error);
    throw new Error('Email sending failed');
  }
};

// Send welcome email
exports.sendWelcomeEmail = async (email, name) => {
  try {
    const html = compileTemplate('welcome', {
      name,
      year: new Date().getFullYear(),
    });

    const mailOptions = {
      from: `"Vestra" <${process.env.EMAIL_USERNAME}>`,
      to: email,
      subject: 'Welcome to Vestra!',
      html,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Welcome email sent to ${email}`);
  } catch (error) {
    console.error(`Error sending welcome email to ${email}:`, error);
    throw new Error('Email sending failed');
  }
};