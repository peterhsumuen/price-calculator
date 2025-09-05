import './StarBorder.css';

const StarBorder = ({
  className = '',
  color = 'white',
  speed = '4.5s',
  thickness = 1.5,
  children,
  ...rest
}) => {
  return (
    <div
      className="star-border-container"
      style={{
        // This padding reveals the gradient "stars"
        padding: `${thickness}px`,
      }}
    >
      <div
        className="border-gradient-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed
        }}
      ></div>
      <div
        className="border-gradient-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed
        }}
      ></div>
      <button className={`inner-content ${className}`} {...rest}>
        {children}
      </button>
    </div>
  );
};

export default StarBorder;