const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

// Email transporter setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USERNAME || "kamdilichukwu2020@gmail.com",
        pass: process.env.EMAIL_PASSWORD || "fmng iriu xabm urkz" || "KAMDILIc1#"
    }
});

transporter.verify((error) => {
    if (error) {
        console.error('Email server connection error:', error);
    } else {
        console.log('Email server is ready to send messages');
    }
});

// Helper function to compile and return template string
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
        year: new Date().getFullYear()
      });
  
      const mailOptions = {
        from: `"SocialApp" <${process.env.EMAIL_USERNAME}>`,
        to: email,
        subject: 'Verify Your Email Address',
        html
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
    const html = compileTemplate('welcome', {
        name,
        year: new Date().getFullYear()
    });

    const mailOptions = {
        from: `"SocialApp" <${process.env.EMAIL_USERNAME}>`,
        to: email,
        subject: 'Welcome to SocialApp!',
        html
    };

    await transporter.sendMail(mailOptions);
};
